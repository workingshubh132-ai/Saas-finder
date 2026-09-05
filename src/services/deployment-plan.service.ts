import type { ApprovalRequest, DeploymentPlan } from "@prisma/client";
import { deploymentPlanRepository } from "../db/repositories/deployment-plan.repository.js";
import { hashDeploymentPlan } from "../domain/approval/resource-snapshot.js";
import { DEPLOYMENT_PLAN_STATUS_TRANSITIONS, isDeploymentPlanStatus } from "../domain/deployment-plan/deployment-plan.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { assertHumanOrSystemActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";

export interface RequestDeploymentPlanApprovalParams {
  deploymentPlanId: string;
  requestedByAgentId: string;
}

export interface ApplyDeploymentPlanDecisionParams {
  approvalRequestId: string;
  actor: Actor;
}

/**
 * The RED-tier human-approval gate on a DeploymentPlan
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §5-6, §17) — reuses approvalService
 * UNMODIFIED, exactly like messageApprovalService (M5): no code path
 * here deploys anything. Approval binds to the EXACT plan row —
 * ApprovalRequest.resourceId is the plan's own id, so "approve plan A"
 * can never become "deploy plan B."
 */
export const deploymentPlanService = {
  async getOrThrow(id: string): Promise<DeploymentPlan> {
    const plan = await deploymentPlanRepository.findById(id);
    if (!plan) throw new NotFoundError("DeploymentPlan", id);
    return plan;
  },

  async setStatus(id: string, toStatus: string): Promise<DeploymentPlan> {
    if (!isDeploymentPlanStatus(toStatus)) throw new ValidationError(`Unknown deployment plan status: ${toStatus}`);
    const plan = await deploymentPlanService.getOrThrow(id);
    if (!isDeploymentPlanStatus(plan.status)) throw new ValidationError(`Corrupt stored status on deployment plan ${plan.id}: ${plan.status}`);
    assertTransition("DeploymentPlan", DEPLOYMENT_PLAN_STATUS_TRANSITIONS, plan.status, toStatus);
    return deploymentPlanRepository.updateStatus(id, toStatus);
  },

  /** DRAFT -> PENDING_APPROVAL, with a real RED-risk ApprovalRequest bound to this exact plan id. */
  async requestApproval(params: RequestDeploymentPlanApprovalParams): Promise<ApprovalRequest> {
    const plan = await deploymentPlanService.getOrThrow(params.deploymentPlanId);
    if (plan.status !== "DRAFT") {
      throw new ValidationError(`DeploymentPlan ${plan.id} is not DRAFT (status: ${plan.status}) — approval may only be requested for a fresh plan.`);
    }

    const approvalRequest = await approvalService.requestApproval({
      requestedByAgentId: params.requestedByAgentId,
      action: "DEPLOY_PRODUCTION",
      description: `Approve deploying this exact plan (environment=${plan.environment}, provider=${plan.provider}) for product ${plan.productId}.`,
      riskLevel: "RED",
      resourceType: "DEPLOYMENT_PLAN",
      resourceId: plan.id,
      reason: plan.strategy,
      resourceStateHash: hashDeploymentPlan(plan),
    });

    await deploymentPlanRepository.attachApprovalRequest(plan.id, approvalRequest.id);

    await auditService.record({
      actorType: "AGENT",
      actorId: params.requestedByAgentId,
      action: "REQUEST_DEPLOYMENT_PLAN_APPROVAL",
      resourceType: "DEPLOYMENT_PLAN",
      resourceId: plan.id,
      result: "SUCCESS",
      metadata: { approvalRequestId: approvalRequest.id },
    });

    return approvalRequest;
  },

  /**
   * The one operation a human calls to turn an already-decided
   * ApprovalRequest into the plan's own real status transition —
   * mirrors messageApprovalService.applyDecision's own decoupled
   * decision-vs-mutation pattern and idempotent early-return exactly.
   * Never itself deploys anything; APPROVED only ever reaches
   * HUMAN_APPROVED, a status that still requires a separate, explicit
   * deploymentService.execute call before anything real happens.
   */
  async applyDecision(params: ApplyDeploymentPlanDecisionParams): Promise<DeploymentPlan> {
    assertHumanOrSystemActor(params.actor);

    const approvalRequest = await approvalService.getOrThrow(params.approvalRequestId);
    if (approvalRequest.resourceType !== "DEPLOYMENT_PLAN" || !approvalRequest.resourceId) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not tied to a DeploymentPlan.`);
    }
    if (approvalRequest.status !== "APPROVED" && approvalRequest.status !== "REJECTED") {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} has not been decided yet (status: ${approvalRequest.status}).`);
    }

    const plan = await deploymentPlanService.getOrThrow(approvalRequest.resourceId);
    if (plan.status === "HUMAN_APPROVED" || plan.status === "REJECTED" || plan.status === "EXECUTED") {
      return plan; // Idempotent — already applied.
    }

    const toStatus = approvalRequest.status === "APPROVED" ? "HUMAN_APPROVED" : "REJECTED";
    const updated = await deploymentPlanService.setStatus(plan.id, toStatus);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `DEPLOYMENT_PLAN_${plan.status}_TO_${toStatus}`,
      resourceType: "DEPLOYMENT_PLAN",
      resourceId: plan.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

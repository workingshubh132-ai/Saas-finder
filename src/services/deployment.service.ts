import type { Deployment } from "@prisma/client";
import { deploymentRepository } from "../db/repositories/deployment.repository.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { createDeploymentProvider } from "../providers/deployment-provider-factory.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { deploymentPlanService } from "./deployment-plan.service.js";
import { eventBus } from "./event-bus.js";
import { productService } from "./product.service.js";

export interface ExecuteDeploymentParams {
  deploymentPlanId: string;
  actor: Actor;
}

export interface RollbackDeploymentParams {
  deploymentId: string;
  actor: Actor;
}

/**
 * The EXECUTE step (docs/M7_ARCHITECTURE_PROPOSAL.md §5-6, §17-18) —
 * the one new kind of step M7 introduces: a human-actor-only service
 * method, never reachable from agentRuntimeService, that re-verifies
 * an exact, already-recorded approval before calling a
 * DeploymentProvider. No Guardian permission check happens here —
 * Guardian governs what AGENTS may do; a verified human exercising
 * their own authority is a structurally different, already-precedented
 * event (Constitution §2).
 */
export const deploymentService = {
  async execute(params: ExecuteDeploymentParams): Promise<Deployment> {
    assertHumanActor(params.actor);

    const plan = await deploymentPlanService.getOrThrow(params.deploymentPlanId);
    if (plan.status !== "HUMAN_APPROVED") {
      throw new ValidationError(`DeploymentPlan ${plan.id} is not HUMAN_APPROVED (status: ${plan.status}) — cannot execute.`);
    }
    if (!plan.approvalRequestId) {
      throw new ValidationError(`DeploymentPlan ${plan.id} has no bound ApprovalRequest.`);
    }
    // Exact-action re-verification (§5-6): the approval must still be
    // APPROVED and bound to THIS exact plan id — never trusted from
    // plan.status alone.
    const approvalRequest = await approvalService.getOrThrow(plan.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" || approvalRequest.resourceType !== "DEPLOYMENT_PLAN" || approvalRequest.resourceId !== plan.id) {
      throw new NotFoundError("Approved ApprovalRequest for DeploymentPlan", plan.id);
    }

    const product = await productService.getOrThrow(plan.productId);
    if (product.status !== "AWAITING_LAUNCH_APPROVAL") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — cannot execute a deployment (expected AWAITING_LAUNCH_APPROVAL).`);
    }
    const actorRef = { actorType: params.actor.actorType, actorId: params.actor.actorId };
    await productService.setStatus(product.id, "DEPLOYING", actorRef);

    const provider = createDeploymentProvider();
    const result = await provider.deploy({ environment: plan.environment, artifactRef: plan.artifactRef });

    const deployment = await deploymentRepository.create({
      deploymentPlanId: plan.id,
      provider: provider.id,
      environment: plan.environment,
      status: result.status,
      providerRef: result.providerRef,
      detail: result.detail,
      deployedByIdentityId: params.actor.actorId,
      deployedAt: new Date(),
    });

    if (result.status === "LIVE") {
      // DeploymentPlan.status only ever advances to EXECUTED on a real, successful Deployment (§39) — never on the attempt alone.
      await deploymentPlanService.setStatus(plan.id, "EXECUTED");
      await productService.setStatus(product.id, "LIVE", actorRef);
    } else {
      // A failed attempt never advances DeploymentPlan.status — the
      // same already-approved plan can be re-executed without a fresh
      // approval (§39), so Product reverts to AWAITING_LAUNCH_APPROVAL
      // rather than a terminal FAILED.
      await productService.setStatus(product.id, "AWAITING_LAUNCH_APPROVAL", actorRef);
    }

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `DEPLOYMENT_EXECUTE_${result.status}`,
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: result.status === "LIVE" ? "SUCCESS" : "FAILURE",
      metadata: { deploymentPlanId: plan.id, deploymentId: deployment.id, providerRef: result.providerRef, provider: provider.id },
    });
    if (result.status === "LIVE") {
      await eventBus.publish({ type: "PRODUCT_DEPLOYED", payload: { productId: product.id, deploymentId: deployment.id, environment: plan.environment, provider: provider.id } });
    }

    return deployment;
  },

  /**
   * The safety valve (§18) — assertHumanActor-gated only, no fresh
   * ApprovalRequest: reversing a live deployment is what the whole
   * design exists to make usable quickly, not a second consequential
   * forward action.
   */
  async rollback(params: RollbackDeploymentParams): Promise<Deployment> {
    assertHumanActor(params.actor);

    const deployment = await deploymentRepository.findById(params.deploymentId);
    if (!deployment) throw new NotFoundError("Deployment", params.deploymentId);
    if (deployment.status !== "LIVE") {
      throw new ValidationError(`Deployment ${deployment.id} is not LIVE (status: ${deployment.status}) — nothing to roll back.`);
    }
    // The original row's own status is never mutated (rollbacks are new
    // rows, §18) — so LIVE alone doesn't prove this hasn't already been
    // rolled back once; check explicitly rather than double-transitioning Product.
    const existingRollback = await deploymentRepository.findRollbackOf(deployment.id);
    if (existingRollback) {
      throw new ValidationError(`Deployment ${deployment.id} has already been rolled back (see Deployment ${existingRollback.id}).`);
    }

    const plan = await deploymentPlanService.getOrThrow(deployment.deploymentPlanId);
    const provider = createDeploymentProvider();
    const result = await provider.rollback({ providerRef: deployment.providerRef });

    const rollbackDeployment = await deploymentRepository.create({
      deploymentPlanId: plan.id,
      provider: provider.id,
      environment: deployment.environment,
      status: result.status === "ROLLED_BACK" ? "ROLLED_BACK" : "FAILED",
      providerRef: deployment.providerRef,
      detail: result.detail,
      rolledBackFromId: deployment.id,
      deployedByIdentityId: params.actor.actorId,
      deployedAt: new Date(),
    });

    if (result.status === "ROLLED_BACK") {
      await productService.setStatus(plan.productId, "PAUSED", { actorType: params.actor.actorType, actorId: params.actor.actorId });
    }

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `DEPLOYMENT_ROLLBACK_${result.status}`,
      resourceType: "PRODUCT",
      resourceId: plan.productId,
      result: result.status === "ROLLED_BACK" ? "SUCCESS" : "FAILURE",
      metadata: { deploymentId: rollbackDeployment.id, rolledBackFromId: deployment.id },
    });
    if (result.status === "ROLLED_BACK") {
      await eventBus.publish({ type: "PRODUCT_ROLLED_BACK", payload: { productId: plan.productId, deploymentId: rollbackDeployment.id } });
    }

    return rollbackDeployment;
  },
};

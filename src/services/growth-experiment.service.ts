import type { ApprovalRequest, GrowthExperiment } from "@prisma/client";
import { growthExperimentRepository, type CreateGrowthExperimentInput } from "../db/repositories/growth-experiment.repository.js";
import { hashGrowthExperiment } from "../domain/approval/resource-snapshot.js";
import { GROWTH_EXPERIMENT_TRANSITIONS, isGrowthExperimentStatus } from "../domain/growth-experiment/growth-experiment.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { assertHumanOrSystemActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";

export interface RequestGrowthExperimentApprovalParams {
  growthExperimentId: string;
  requestedByAgentId: string;
}

export interface ApplyGrowthExperimentDecisionParams {
  approvalRequestId: string;
  actor: Actor;
}

/**
 * PLAN/APPROVE for a GrowthExperiment (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §25-26) — mirrors deploymentPlanService exactly. No new Guardian
 * permission (§24's own finding: zero new permissions needed for M8);
 * "RUN_GROWTH_EXPERIMENT" is a free descriptive action string
 * (approvalService.requestApproval's `action` field has always been a
 * plain string, never constrained to the Permission enum), classified
 * YELLOW — an external-facing but bounded, reversible change, the same
 * tier DEPLOY_APPLICATION/CREATE_EXTERNAL_ACCOUNT already occupy.
 * Every experiment requires this gate regardless of its own
 * LOW/MEDIUM/HIGH self-classification (M8 brief §15: "do not allow an
 * experiment to run without the appropriate approval" — no exception).
 */
export const growthExperimentService = {
  async create(input: CreateGrowthExperimentInput): Promise<GrowthExperiment> {
    return growthExperimentRepository.create(input);
  },

  async getOrThrow(id: string): Promise<GrowthExperiment> {
    return growthExperimentRepository.getOrThrow(id);
  },

  listForProduct(productId: string): Promise<GrowthExperiment[]> {
    return growthExperimentRepository.listForProduct(productId);
  },

  async setStatus(id: string, toStatus: string): Promise<GrowthExperiment> {
    if (!isGrowthExperimentStatus(toStatus)) throw new ValidationError(`Unknown growth experiment status: ${toStatus}`);
    const experiment = await growthExperimentService.getOrThrow(id);
    if (!isGrowthExperimentStatus(experiment.status)) throw new ValidationError(`Corrupt stored status on growth experiment ${experiment.id}: ${experiment.status}`);
    assertTransition("GrowthExperiment", GROWTH_EXPERIMENT_TRANSITIONS, experiment.status, toStatus);
    return growthExperimentRepository.updateStatus(id, toStatus);
  },

  /** ANALYZED -> AWAITING_APPROVAL, with a real YELLOW-risk ApprovalRequest bound to this exact experiment id. */
  async requestApproval(params: RequestGrowthExperimentApprovalParams): Promise<ApprovalRequest> {
    const experiment = await growthExperimentService.getOrThrow(params.growthExperimentId);
    if (experiment.status !== "ANALYZED") {
      throw new ValidationError(`GrowthExperiment ${experiment.id} is not ANALYZED (status: ${experiment.status}) — approval may only be requested once analysis is complete.`);
    }
    await growthExperimentService.setStatus(experiment.id, "AWAITING_APPROVAL");

    const approvalRequest = await approvalService.requestApproval({
      requestedByAgentId: params.requestedByAgentId,
      action: "RUN_GROWTH_EXPERIMENT",
      description: `Approve running this exact experiment: "${experiment.hypothesis}" (estimated cost $${experiment.estimatedCostUsd.toFixed(2)}, risk=${experiment.riskLevel}, duration=${experiment.durationDays}d).`,
      riskLevel: "YELLOW",
      resourceType: "GROWTH_EXPERIMENT",
      resourceId: experiment.id,
      reason: experiment.hypothesis,
      resourceStateHash: hashGrowthExperiment(experiment),
    });
    await growthExperimentRepository.setApprovalRequest(experiment.id, approvalRequest.id);

    await auditService.record({
      actorType: "AGENT",
      actorId: params.requestedByAgentId,
      action: "REQUEST_GROWTH_EXPERIMENT_APPROVAL",
      resourceType: "GROWTH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { approvalRequestId: approvalRequest.id },
    });

    return approvalRequest;
  },

  /** Idempotent, mirrors deploymentPlanService.applyDecision exactly — never itself starts the experiment; a separate, human-gated EXECUTE step (growthExperimentExecutionService.approveToRun) does that. */
  async applyDecision(params: ApplyGrowthExperimentDecisionParams): Promise<GrowthExperiment> {
    // See agent.service.ts's assertHumanOrSystemActor doc comment — this only ever mechanically applies
    // a decision an ApprovalRequest already recorded; it re-verifies APPROVED/REJECTED itself below.
    assertHumanOrSystemActor(params.actor);

    const approvalRequest = await approvalService.getOrThrow(params.approvalRequestId);
    if (approvalRequest.resourceType !== "GROWTH_EXPERIMENT" || !approvalRequest.resourceId) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not tied to a GrowthExperiment.`);
    }
    if (approvalRequest.status !== "APPROVED" && approvalRequest.status !== "REJECTED") {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} has not been decided yet (status: ${approvalRequest.status}).`);
    }

    const experiment = await growthExperimentService.getOrThrow(approvalRequest.resourceId);
    if (experiment.status === "APPROVED" || experiment.status === "REJECTED" || experiment.status === "RUNNING" || experiment.status === "COMPLETED") {
      return experiment; // Idempotent — already applied.
    }

    const toStatus = approvalRequest.status === "APPROVED" ? "APPROVED" : "REJECTED";
    const updated = await growthExperimentService.setStatus(experiment.id, toStatus);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `GROWTH_EXPERIMENT_${experiment.status}_TO_${toStatus}`,
      resourceType: "GROWTH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

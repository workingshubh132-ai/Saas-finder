import type { GrowthExperiment, GrowthExperimentResult } from "@prisma/client";
import { growthExperimentRepository } from "../db/repositories/growth-experiment.repository.js";
import { growthExperimentResultRepository } from "../db/repositories/growth-experiment-result.repository.js";
import { MIN_EXPERIMENT_SAMPLE } from "../domain/growth-experiment/growth-experiment.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { growthExperimentService } from "./growth-experiment.service.js";

export interface ApproveToRunParams {
  growthExperimentId: string;
  actor: Actor;
}

export interface CompleteExperimentParams {
  growthExperimentId: string;
  baselineValue: number;
  experimentValue: number;
  sampleSize: number;
  limitations: string;
}

/**
 * The EXECUTE step (docs/M8_ARCHITECTURE_PROPOSAL.md §25) —
 * `assertHumanActor`-gated, re-verifies the APPROVED ApprovalRequest is
 * bound to this exact experiment before starting it, mirroring
 * deploymentService.execute's own re-verification discipline. Unlike
 * deployment/billing EXECUTE, there is no provider call here: running
 * a growth experiment in this milestone's dev-fixture world is a
 * status flag plus a bounded observation window, not an external side
 * effect (§25's own documented scope).
 */
export const growthExperimentExecutionService = {
  async approveToRun(params: ApproveToRunParams): Promise<GrowthExperiment> {
    assertHumanActor(params.actor);

    const experiment = await growthExperimentService.getOrThrow(params.growthExperimentId);
    if (experiment.status !== "APPROVED") {
      throw new ValidationError(`GrowthExperiment ${experiment.id} is not APPROVED (status: ${experiment.status}) — cannot start.`);
    }
    if (!experiment.approvalRequestId) {
      throw new ValidationError(`GrowthExperiment ${experiment.id} has no bound ApprovalRequest.`);
    }
    const approvalRequest = await approvalService.getOrThrow(experiment.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" || approvalRequest.resourceId !== experiment.id) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not an APPROVED decision bound to exactly this experiment.`);
    }

    const updated = await growthExperimentRepository.markStarted(experiment.id);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "GROWTH_EXPERIMENT_STARTED",
      resourceType: "GROWTH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { approvalRequestId: approvalRequest.id },
    });

    return updated;
  },

  /**
   * Mechanical recording of an already-approved, already-running
   * experiment's real observed outcome — no fresh consequential action,
   * so no human-actor gate (docs/M8_ARCHITECTURE_PROPOSAL.md §16).
   * Confidence is deterministic from sample size alone, never a
   * fabricated p-value (M8 brief §16, §51).
   */
  async completeExperiment(params: CompleteExperimentParams): Promise<{ experiment: GrowthExperiment; result: GrowthExperimentResult }> {
    const experiment = await growthExperimentService.getOrThrow(params.growthExperimentId);
    if (experiment.status !== "RUNNING") {
      throw new ValidationError(`GrowthExperiment ${experiment.id} is not RUNNING (status: ${experiment.status}) — cannot complete.`);
    }

    const observedChangePct = params.baselineValue === 0 ? 0 : (params.experimentValue - params.baselineValue) / Math.abs(params.baselineValue);
    const confidence = params.sampleSize < MIN_EXPERIMENT_SAMPLE ? "LOW_CONFIDENCE" : Math.abs(observedChangePct) >= 0.15 ? "HIGH_CONFIDENCE" : "MODERATE";
    const decision = confidence === "LOW_CONFIDENCE" ? "INCONCLUSIVE — sample too small to trust" : observedChangePct > 0 ? "POSITIVE — worth scaling" : "NEGATIVE — do not scale";

    const result = await growthExperimentResultRepository.create({
      growthExperimentId: experiment.id,
      baselineValue: params.baselineValue,
      experimentValue: params.experimentValue,
      sampleSize: params.sampleSize,
      observedChangePct,
      confidence,
      limitations: params.limitations,
      decision,
    });

    const updated = await growthExperimentRepository.markEnded(experiment.id, "COMPLETED");

    await auditService.record({
      actorType: "SYSTEM",
      actorId: "growth-experiment-execution",
      action: "GROWTH_EXPERIMENT_COMPLETED",
      resourceType: "GROWTH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { resultId: result.id, observedChangePct, confidence, sampleSize: params.sampleSize },
    });

    return { experiment: updated, result };
  },
};

import type { Claim, GrowthExperiment } from "@prisma/client";
import { z } from "zod";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeExpectedInformationGain } from "../domain/claim/eig.js";
import { isClaimImportance } from "../domain/claim/claim.types.js";
import { isClaimValidationStatus } from "../domain/claim/claim-validation.types.js";
import { GROWTH_EXPERIMENT_RISK_LEVELS } from "../domain/growth-experiment/growth-experiment.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";
import { growthExperimentService } from "./growth-experiment.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/** Zero tool calls (docs/M8_ARCHITECTURE_PROPOSAL.md §14, §26) — proposes a plan, never runs anything itself. */
export const EXPERIMENT_ANALYST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const experimentAnalystOutputSchema = z.object({
  hypothesis: z.string().min(1),
  interventionDescription: z.string().min(1),
  controlDescription: z.string().min(1),
  successCriteria: z.string().min(1),
  failureCriteria: z.string().min(1),
  estimatedCostUsd: z.number().min(0),
  riskLevel: z.enum(GROWTH_EXPERIMENT_RISK_LEVELS),
  durationDays: z.number().int().min(1).max(90),
  reasoning: z.string().min(1),
});
export type ExperimentAnalystOutput = z.infer<typeof experimentAnalystOutputSchema>;

const EXPERIMENT_ANALYST_SYSTEM_PROMPT =
  "You are the Experiment Analyst for VentureForge (docs/M8_ARCHITECTURE_PROPOSAL.md §14, §26). Your job: turn " +
  "uncertainty into a controlled experiment. You have been given the single lowest-confidence, highest-value-to-" +
  "resolve claim about this LIVE product (ranked by Expected Information Gain, an existing formula — you did not " +
  "compute this ranking). Propose ONE experiment that would genuinely move this specific claim: hypothesis, " +
  "intervention (what changes), control (what stays the same for comparison), successCriteria, failureCriteria, an " +
  "honest estimatedCostUsd, riskLevel, and durationDays. You have no tools and cannot run anything yourself — this " +
  "is a PLAN a human will separately approve. " +
  'Respond with ONLY JSON matching: {"hypothesis": string, "interventionDescription": string, ' +
  '"controlDescription": string, "successCriteria": string, "failureCriteria": string, "estimatedCostUsd": number, ' +
  '"riskLevel": "LOW"|"MEDIUM"|"HIGH", "durationDays": number, "reasoning": string}';

function buildExperimentAnalystPrompt(claim: Claim, eig: number): string {
  return [
    `Target claim: [id=${claim.id}] [${claim.claimType}] status=${claim.status} confidence=${claim.confidence.toFixed(2)}: ${claim.statement}`,
    `Expected Information Gain (higher = more valuable to resolve): ${eig.toFixed(3)}`,
  ].join("\n");
}

/** DEVELOPMENT ONLY — deterministic, derived from the real target claim's own type/statement. */
function buildDevExperimentAnalystFixture(claim: Claim): ExperimentAnalystOutput {
  return {
    hypothesis: `[DEV FIXTURE] Changing the product experience relevant to "${claim.claimType}" will move this claim's confidence — currently: ${claim.statement}`,
    interventionDescription: `[DEV FIXTURE] A/B test a targeted change to the flow most related to ${claim.claimType.toLowerCase().replace(/_/g, " ")}.`,
    controlDescription: "[DEV FIXTURE] The existing, unchanged experience, run in parallel for the same period.",
    successCriteria: "[DEV FIXTURE] The target metric improves by at least 15% relative to the control group.",
    failureCriteria: "[DEV FIXTURE] The target metric is unchanged or worse in the intervention group.",
    estimatedCostUsd: 0,
    riskLevel: "LOW",
    durationDays: 14,
    reasoning: `[DEV FIXTURE] This claim was selected because it is the lowest-confidence, highest-importance open claim for this product, per Expected Information Gain — the same formula already used for evidence-gap prioritization.`,
  };
}

export interface RunExperimentAnalystParams {
  agentId: string;
  productId: string;
  targetMetricType: string;
  startedBy: AuthenticatedActor;
}

export const experimentAnalystService = {
  async run(params: RunExperimentAnalystParams): Promise<RunOutcome<{ growthExperiment: GrowthExperiment; targetClaim: Claim }>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "LIVE" && product.status !== "PAUSED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — Experiment Analyst only runs against a LIVE (or PAUSED) product.`);
    }

    const claims = await claimRepository.listForOpportunity(product.opportunityId);
    if (claims.length === 0) {
      throw new ValidationError(`Product ${product.id}'s opportunity has no claims yet — nothing to target an experiment at.`);
    }

    let targetClaim: Claim | null = null;
    let targetEig = -Infinity;
    for (const claim of claims) {
      if (!isClaimImportance(claim.importance) || !isClaimValidationStatus(claim.status)) continue;
      const eig = computeExpectedInformationGain({ importance: claim.importance, status: claim.status, normalizedResearchCost: 0.3 });
      if (eig > targetEig) {
        targetEig = eig;
        targetClaim = claim;
      }
    }
    if (!targetClaim) throw new ValidationError(`Product ${product.id} has no claim with a valid importance/status to target.`);
    const resolvedTargetClaim = targetClaim;

    const execution = await agentRuntimeService.startExecution({ agentId: params.agentId, taskId: null, input: { productId: params.productId }, startedBy: params.startedBy });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, experimentAnalystOutputSchema, {
          systemPrompt: EXPERIMENT_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildExperimentAnalystPrompt(resolvedTargetClaim, targetEig) }],
          devFixtureResponse: buildDevExperimentAnalystFixture(resolvedTargetClaim),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const draft = await growthExperimentService.create({
          productId: product.id,
          claimId: resolvedTargetClaim.id,
          hypothesis: output.hypothesis,
          interventionDescription: output.interventionDescription,
          controlDescription: output.controlDescription,
          targetMetricType: params.targetMetricType,
          successCriteria: output.successCriteria,
          failureCriteria: output.failureCriteria,
          estimatedCostUsd: output.estimatedCostUsd,
          riskLevel: output.riskLevel,
          durationDays: output.durationDays,
        });
        const growthExperiment = await growthExperimentService.setStatus(draft.id, "ANALYZED");

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "GROWTH_EXPERIMENT_PROPOSED",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { growthExperimentId: growthExperiment.id, targetClaimId: resolvedTargetClaim.id, eig: targetEig },
        });

        return { growthExperiment, targetClaim: resolvedTargetClaim };
      },
      EXPERIMENT_ANALYST_BUDGET,
    );
  },
};

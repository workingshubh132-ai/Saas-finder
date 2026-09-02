import type { CeoRecommendation, Claim, DecisionCycle } from "@prisma/client";
import { decisionCycleRepository, type UpdateDecisionCycleInput } from "../db/repositories/decision-cycle.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { CLAIM_IMPORTANCE_WEIGHT, isClaimImportance, type ClaimImportance } from "../domain/claim/claim.types.js";
import { DECISION_CYCLE_STATUS_TRANSITIONS, isDecisionCycleStatus, type DecisionCycleStatus } from "../domain/decision-cycle/decision-cycle.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { authorizationService } from "./authorization.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { claimConfidenceService } from "./claim-confidence.service.js";
import { claimExtractionService } from "./claim-extraction.service.js";
import { eventBus } from "./event-bus.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import { evidenceValidatorService } from "./evidence-validator.service.js";
import { researchQueueService } from "./research-queue.service.js";

export interface DecisionCycleBudget {
  maxClaims: number;
  maxValidatorSearches: number;
  maxModelCalls: number;
  maxResearchTasks: number;
  maxCeoPlanningSteps: number;
  maxDurationMs: number;
}

/** Sized to comfortably cover one cold-start cycle over a handful of
 *  claims with margin, not derived from an SLA — a founder-revisable
 *  number like every other budget in this codebase
 *  (docs/M4_ARCHITECTURE_PROPOSAL.md §25; docs/DECISIONS.md). */
export const DEFAULT_DECISION_CYCLE_BUDGET: DecisionCycleBudget = {
  maxClaims: 20,
  maxValidatorSearches: 10,
  maxModelCalls: 15,
  maxResearchTasks: 5,
  maxCeoPlanningSteps: 3,
  maxDurationMs: 180_000,
};

export interface RunDecisionCycleParams {
  opportunityId: string;
  evidenceValidatorAgentId: string;
  ceoAgentId: string;
  startedBy: AuthenticatedActor;
  budgetOverrides?: Partial<DecisionCycleBudget>;
}

export interface DecisionCycleSummary {
  cycle: DecisionCycle;
  claimsExtracted: number;
  claimsValidated: number;
  ceoRecommendation: CeoRecommendation | null;
}

/**
 * The CEO-pipeline sibling of researchCycleService (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §16, §21, §25) — deterministic orchestration CODE, layered on top of
 * the unchanged researchCycleService/agentRuntimeService/Guardian
 * chain, never bypassing any of them. Stops at "CEO recommendation
 * issued," mirroring researchCycleService's own scope boundary
 * exactly: Chairman review (chairman.service.ts, extended §19),
 * Investment Memo compilation (§17), and the KILL/PREPARE_REVIEW/
 * HUMAN_REVIEW ApprovalRequest wiring (§20) are separate, subsequent,
 * caller-orchestrated steps — a gated CEO recommendation is never
 * auto-applied from inside this service.
 */
export const decisionCycleService = {
  async run(params: RunDecisionCycleParams): Promise<DecisionCycleSummary> {
    const budget: DecisionCycleBudget = { ...DEFAULT_DECISION_CYCLE_BUDGET, ...params.budgetOverrides };

    let cycle = await decisionCycleRepository.create({
      opportunityId: params.opportunityId,
      startedByIdentityId: params.startedBy.identityId,
      maxClaims: budget.maxClaims,
      maxValidatorSearches: budget.maxValidatorSearches,
      maxModelCalls: budget.maxModelCalls,
      maxResearchTasks: budget.maxResearchTasks,
      maxCeoPlanningSteps: budget.maxCeoPlanningSteps,
      maxDurationMs: budget.maxDurationMs,
    });
    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: "START_DECISION_CYCLE",
      resourceType: "DECISION_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      metadata: { opportunityId: params.opportunityId },
    });
    await eventBus.publish({ type: "DECISION_CYCLE_STARTED", payload: { decisionCycleId: cycle.id, opportunityId: params.opportunityId } });

    // The same AWAITING_HUMAN discipline researchCycleService established
    // (docs/RESEARCH_SCHEDULING.md): the cycle can't even start if its
    // Evidence Validator currently lacks the grant it needs to search
    // for counter-evidence — surfaced the same queue-shaped way as
    // every other decision, not buried in a mid-run failure.
    if (budget.maxValidatorSearches > 0) {
      const authDecision = await authorizationService.authorize({ agentId: params.evidenceValidatorAgentId, action: "READ_WEB" });
      if (authDecision.decision !== "ALLOWED") {
        cycle = await transitionCycle(cycle, "AWAITING_HUMAN");
        return { cycle, claimsExtracted: 0, claimsValidated: 0, ceoRecommendation: null };
      }
    }

    cycle = await transitionCycle(cycle, "RUNNING", { startedAt: new Date() });
    const startedAt = cycle.startedAt ?? new Date();
    const usage = { claimsValidated: 0, validatorSearches: 0, modelCalls: 0, researchTasks: 0, ceoPlanningSteps: 0 };

    const withinBudget = (): boolean =>
      Date.now() - startedAt.getTime() <= budget.maxDurationMs &&
      usage.claimsValidated <= budget.maxClaims &&
      usage.validatorSearches <= budget.maxValidatorSearches &&
      usage.modelCalls <= budget.maxModelCalls;

    let stoppedReason: string | null = null;

    const claims = await claimExtractionService.extractForOpportunity({
      opportunityId: params.opportunityId,
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
    });

    // Validate the highest-importance claims first when the cycle can't
    // cover all of them — resolving a CRITICAL claim's uncertainty
    // outranks a LOW one, the same information-value ordering the EIG
    // formula itself encodes (§14, §15).
    const orderedClaims = orderByImportance(claims);
    const validatedClaims: Claim[] = [];

    for (const claim of orderedClaims) {
      if (!withinBudget()) {
        stoppedReason = "Decision cycle exceeded its budget during evidence validation.";
        break;
      }
      const searchesForThisClaim = Math.min(2, Math.max(0, budget.maxValidatorSearches - usage.validatorSearches));
      const outcome = await evidenceValidatorService.run({
        agentId: params.evidenceValidatorAgentId,
        claimId: claim.id,
        maxSearches: searchesForThisClaim,
        startedBy: params.startedBy,
      });
      usage.validatorSearches += outcome.execution.toolCallCount;
      usage.modelCalls += outcome.execution.modelCallCount;
      usage.claimsValidated += 1;

      if (outcome.status !== "COMPLETED") continue;

      const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({
        claimId: claim.id,
        actorType: params.startedBy.type,
        actorId: params.startedBy.id,
      });
      await evidenceGapService.analyzeClaim({ claim: updatedClaim, recommendedResearch: null });
      validatedClaims.push(updatedClaim);
    }

    if (validatedClaims.length > 0) {
      await claimConfidenceService.recalculateOpportunityConfidence({ opportunityId: params.opportunityId, scoredBy: params.evidenceValidatorAgentId });
    }

    if (!stoppedReason && usage.researchTasks < budget.maxResearchTasks) {
      const queueItems = await researchQueueService.populateForOpportunity(params.opportunityId);
      usage.researchTasks += Math.min(queueItems.length, budget.maxResearchTasks - usage.researchTasks);
    }

    let ceoRecommendation: CeoRecommendation | null = null;
    if (!stoppedReason && usage.ceoPlanningSteps < budget.maxCeoPlanningSteps && usage.modelCalls < budget.maxModelCalls) {
      const ceoOutcome = await ceoReasoningService.run({
        agentId: params.ceoAgentId,
        opportunityId: params.opportunityId,
        decisionCycleId: cycle.id,
        startedBy: params.startedBy,
      });
      usage.ceoPlanningSteps += 1;
      usage.modelCalls += ceoOutcome.execution.modelCallCount;
      if (ceoOutcome.status === "COMPLETED") ceoRecommendation = ceoOutcome.result.recommendation;
    }

    cycle = await decisionCycleRepository.update(cycle.id, {
      claimsValidated: usage.claimsValidated,
      validatorSearchCount: usage.validatorSearches,
      modelCallCount: usage.modelCalls,
      researchTasksCreated: usage.researchTasks,
      ceoPlanningSteps: usage.ceoPlanningSteps,
    });
    // STOP, AUDIT, PRESERVE PARTIAL RESULTS (§25) — every row already
    // committed above stays exactly as it is; nothing is rolled back.
    cycle = await transitionCycle(cycle, stoppedReason ? "STOPPED" : "COMPLETED", { completedAt: new Date(), stoppedReason });

    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: stoppedReason ? "DECISION_CYCLE_STOPPED" : "DECISION_CYCLE_COMPLETED",
      resourceType: "DECISION_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: stoppedReason,
      metadata: { claimsValidated: usage.claimsValidated, ceoAction: ceoRecommendation?.action ?? null },
    });
    await eventBus.publish({
      type: "DECISION_CYCLE_COMPLETED",
      payload: { decisionCycleId: cycle.id, opportunityId: params.opportunityId, status: cycle.status, ceoAction: ceoRecommendation?.action ?? null },
    });

    return { cycle, claimsExtracted: claims.length, claimsValidated: usage.claimsValidated, ceoRecommendation };
  },
};

function orderByImportance(claims: readonly Claim[]): Claim[] {
  return [...claims].sort((a, b) => {
    const aWeight = isClaimImportance(a.importance) ? CLAIM_IMPORTANCE_WEIGHT[a.importance as ClaimImportance] : 0;
    const bWeight = isClaimImportance(b.importance) ? CLAIM_IMPORTANCE_WEIGHT[b.importance as ClaimImportance] : 0;
    return bWeight - aWeight;
  });
}

async function transitionCycle(cycle: DecisionCycle, toStatus: DecisionCycleStatus, extra: UpdateDecisionCycleInput = {}): Promise<DecisionCycle> {
  if (!isDecisionCycleStatus(cycle.status)) {
    throw new ValidationError(`Corrupt stored status on decision cycle ${cycle.id}: ${cycle.status}`);
  }
  assertTransition("DecisionCycle", DECISION_CYCLE_STATUS_TRANSITIONS, cycle.status, toStatus);
  return decisionCycleRepository.update(cycle.id, { status: toStatus, ...extra });
}

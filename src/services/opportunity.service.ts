import type { Evidence, Opportunity } from "@prisma/client";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { evidenceRepository } from "../db/repositories/evidence.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { isEvidenceReliability, isEvidenceSourceType } from "../domain/evidence/evidence.types.js";
import { isOpportunityStatus, OPPORTUNITY_STATUS_TRANSITIONS } from "../domain/opportunity/opportunity.types.js";
import { isValidationLevel } from "../domain/opportunity/validation-level.js";
import { checkValidationLevelRequirement, VALIDATION_LEVEL_REQUIREMENTS, type EvidenceSummaryItem } from "../domain/opportunity/validation-policy.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import type { Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { DeterministicOpportunityScorer, type OpportunityScoreDimensions, type OpportunityScorer } from "./opportunity-scorer.js";
import { DeterministicKillRiskScorer, type KillRiskDimensions, type KillRiskScorer } from "./kill-risk-scorer.js";

const defaultScorer: OpportunityScorer = new DeterministicOpportunityScorer();
const defaultKillRiskScorer: KillRiskScorer = new DeterministicKillRiskScorer();

function toEvidenceSummary(evidence: readonly Evidence[]): EvidenceSummaryItem[] {
  const summary: EvidenceSummaryItem[] = [];
  for (const item of evidence) {
    // Excludes (rather than crashes on) a corrupt row — CHECK
    // constraints make this unreachable in practice, but a stricter
    // level should never be reachable by an unrecognized value either.
    if (isEvidenceSourceType(item.sourceType) && isEvidenceReliability(item.reliability)) {
      summary.push({ sourceType: item.sourceType, reliability: item.reliability, confidence: item.confidence });
    }
  }
  return summary;
}

export interface CreateOpportunityParams {
  title: string;
  problem: string;
  targetCustomer: string;
  description: string;
  metadata?: Record<string, unknown>;
  discoveredBy: Actor;
  /** M3 — traceability root (docs/M3_ARCHITECTURE_PROPOSAL.md §9). */
  problemId?: string | null;
}

export interface ScoreOpportunityParams {
  opportunityId: string;
  dimensions: OpportunityScoreDimensions;
  scoredBy: string;
  scorer?: OpportunityScorer;
  /** M3 — optional: a caller that hasn't assessed kill risk yet (e.g.
   *  M1/M2 callers) simply omits this; the score record's kill-risk
   *  fields stay null rather than a fabricated value. */
  killRiskDimensions?: KillRiskDimensions;
  killRiskScorer?: KillRiskScorer;
}

export const opportunityService = {
  async createOpportunity(params: CreateOpportunityParams): Promise<Opportunity> {
    const opportunity = await opportunityRepository.create({
      title: params.title,
      problem: params.problem,
      targetCustomer: params.targetCustomer,
      description: params.description,
      metadata: params.metadata ? toJsonString(params.metadata) : null,
      problemId: params.problemId ?? null,
    });

    await auditService.record({
      actorType: params.discoveredBy.actorType,
      actorId: params.discoveredBy.actorId,
      action: "CREATE_OPPORTUNITY",
      resourceType: "OPPORTUNITY",
      resourceId: opportunity.id,
      result: "SUCCESS",
    });
    await eventBus.publish({
      type: "OPPORTUNITY_DISCOVERED",
      payload: { opportunityId: opportunity.id, title: opportunity.title },
    });

    return opportunity;
  },

  async getOrThrow(id: string): Promise<Opportunity> {
    const opportunity = await opportunityRepository.findById(id);
    if (!opportunity) throw new NotFoundError("Opportunity", id);
    return opportunity;
  },

  listOpportunities: opportunityRepository.list,

  /** Why does VentureForge believe this opportunity is promising? (Constitution §11) */
  listEvidence: opportunityRepository.listEvidence,
  listScoreHistory: opportunityRepository.listScoreRecords,

  async attachEvidence(params: { opportunityId: string; evidenceId: string; actor: Actor }): Promise<Evidence[]> {
    await opportunityService.getOrThrow(params.opportunityId);
    const evidence = await evidenceRepository.findById(params.evidenceId);
    if (!evidence) throw new NotFoundError("Evidence", params.evidenceId);

    await opportunityRepository.attachEvidence(params.opportunityId, params.evidenceId);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "ATTACH_EVIDENCE",
      resourceType: "OPPORTUNITY",
      resourceId: params.opportunityId,
      result: "SUCCESS",
      metadata: { evidenceId: params.evidenceId },
    });

    return opportunityRepository.listEvidence(params.opportunityId);
  },

  async scoreOpportunity(params: ScoreOpportunityParams): Promise<Opportunity> {
    await opportunityService.getOrThrow(params.opportunityId);
    const scorer = params.scorer ?? defaultScorer;
    const result = scorer.score({ dimensions: params.dimensions, scoredBy: params.scoredBy });

    let killRisk: { killRiskScore: number; killRiskReasons: string[] } | null = null;
    if (params.killRiskDimensions) {
      const killRiskScorer = params.killRiskScorer ?? defaultKillRiskScorer;
      killRisk = killRiskScorer.score(params.killRiskDimensions);
    }

    await opportunityRepository.addScoreRecord({
      opportunityId: params.opportunityId,
      dimensions: toJsonString(params.dimensions),
      opportunityScore: result.opportunityScore,
      confidenceScore: result.confidenceScore,
      scoredBy: params.scoredBy,
      killRiskScore: killRisk?.killRiskScore ?? null,
      killRiskDimensions: params.killRiskDimensions ? toJsonString(params.killRiskDimensions) : null,
      killRiskReasons: killRisk ? toJsonString(killRisk.killRiskReasons) : null,
    });

    const updated = await opportunityRepository.update(params.opportunityId, {
      opportunityScore: result.opportunityScore,
      confidenceScore: result.confidenceScore,
    });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.scoredBy,
      action: "SCORE_OPPORTUNITY",
      resourceType: "OPPORTUNITY",
      resourceId: params.opportunityId,
      result: "SUCCESS",
      metadata: { opportunityScore: result.opportunityScore, confidenceScore: result.confidenceScore },
    });
    await eventBus.publish({
      type: "OPPORTUNITY_SCORED",
      payload: {
        opportunityId: params.opportunityId,
        opportunityScore: result.opportunityScore,
        confidenceScore: result.confidenceScore,
      },
    });

    return updated;
  },

  async transition(params: { id: string; toStatus: string; actor: Actor }): Promise<Opportunity> {
    if (!isOpportunityStatus(params.toStatus)) {
      throw new ValidationError(`Unknown opportunity status: ${params.toStatus}`);
    }
    const opportunity = await opportunityService.getOrThrow(params.id);
    if (!isOpportunityStatus(opportunity.status)) {
      throw new ValidationError(`Corrupt stored status on opportunity ${opportunity.id}: ${opportunity.status}`);
    }
    assertTransition("Opportunity", OPPORTUNITY_STATUS_TRANSITIONS, opportunity.status, params.toStatus);

    const updated = await opportunityRepository.update(params.id, { status: params.toStatus });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `OPPORTUNITY_STATUS_${opportunity.status}_TO_${params.toStatus}`,
      resourceType: "OPPORTUNITY",
      resourceId: params.id,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "OPPORTUNITY_UPDATED", payload: { opportunityId: params.id, status: params.toStatus } });

    return updated;
  },

  /**
   * Agents must not claim a validation level unsupported by evidence
   * (Constitution §14: "must not claim Level 6 based only on Level 1
   * evidence"). The formal per-level policy — minimum evidence count,
   * confidence, required evidence type/reliability, and whether a
   * HUMAN actor and a standing Chairman APPROVE review are required —
   * lives in domain/opportunity/validation-policy.ts (M2 brief Part
   * 14; docs/VALIDATION_POLICY.md). Every unmet condition is reported,
   * never silently rounded up.
   */
  async setValidationLevel(params: { id: string; validationLevel: string; actor: Actor }): Promise<Opportunity> {
    if (!isValidationLevel(params.validationLevel)) {
      throw new ValidationError(`Unknown validation level: ${params.validationLevel}`);
    }
    const opportunity = await opportunityService.getOrThrow(params.id);
    const requirement = VALIDATION_LEVEL_REQUIREMENTS[params.validationLevel];

    if (requirement.requiresHumanActor && params.actor.actorType !== "HUMAN") {
      throw new ValidationError(
        `${params.validationLevel} requires a HUMAN actor to set it (docs/VALIDATION_POLICY.md); got ${params.actor.actorType}.`,
      );
    }

    const evidence = await opportunityRepository.listEvidence(params.id);
    const check = checkValidationLevelRequirement(requirement, toEvidenceSummary(evidence));
    if (!check.satisfied) {
      throw new ValidationError(`Cannot set ${params.validationLevel}: ${check.reasons.join("; ")}`);
    }

    if (requirement.requiresChairmanApproval) {
      const latestReview = await chairmanReviewRepository.findLatestForOpportunity(params.id);
      if (!latestReview || latestReview.decision !== "APPROVE") {
        throw new ValidationError(
          `${params.validationLevel} requires a standing Chairman APPROVE review for this opportunity (latest decision: ${latestReview?.decision ?? "none"}).`,
        );
      }
    }

    const updated = await opportunityRepository.update(params.id, { validationLevel: params.validationLevel });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `VALIDATION_LEVEL_${opportunity.validationLevel}_TO_${params.validationLevel}`,
      resourceType: "OPPORTUNITY",
      resourceId: params.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

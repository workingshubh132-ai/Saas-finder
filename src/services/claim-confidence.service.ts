import type { Claim, Opportunity } from "@prisma/client";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { isClaimImportance, type ClaimImportance } from "../domain/claim/claim.types.js";
import { isClaimValidationStatus } from "../domain/claim/claim-validation.types.js";
import { recalculateClaimConfidence } from "../domain/claim/confidence-formula.js";
import type { EvidenceQualityAssessment } from "../domain/claim/evidence-quality.js";
import { computeAggregateConfidence } from "../domain/claim/opportunity-confidence.js";
import { ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { auditService } from "./audit.service.js";
import { claimService } from "./claim.service.js";
import { eventBus } from "./event-bus.js";

export interface RecalculateClaimParams {
  claimId: string;
  actorType: ActorType;
  actorId: string | null;
}

export interface RecalculateOpportunityConfidenceParams {
  opportunityId: string;
  scoredBy: string;
}

/**
 * Confidence recalculation (docs/M4_ARCHITECTURE_PROPOSAL.md §11) — the
 * one place a ValidationReport's structured output actually changes a
 * Claim's persisted status/confidence, and where claim confidences roll
 * up into a fresh, history-preserving Opportunity confidence score.
 * The Evidence Validator itself never does either (evidence-validator.service.ts).
 */
export const claimConfidenceService = {
  /** Recomputes one Claim's status/confidence from its latest ValidationReport. No-op (returns the claim unchanged) if no report exists yet. */
  async recalculateFromLatestReport(params: RecalculateClaimParams): Promise<Claim> {
    const claim = await claimService.getOrThrow(params.claimId);
    const report = await validationReportRepository.findLatestForClaim(params.claimId);
    if (!report) return claim;

    if (!isClaimValidationStatus(report.status)) {
      throw new ValidationError(`Corrupt stored status on validation report ${report.id}: ${report.status}`);
    }

    const quality = fromJsonString<EvidenceQualityAssessment | null>(report.qualityAssessment, null);
    if (!quality) {
      throw new ValidationError(`ValidationReport ${report.id} has no parseable qualityAssessment.`);
    }

    const supportingCount = fromJsonString<string[]>(report.supportingEvidenceIds, []).length;
    const contradictingCount = fromJsonString<string[]>(report.contradictingEvidenceIds, []).length;

    const newConfidence = recalculateClaimConfidence({
      priorConfidence: claim.confidence,
      status: report.status,
      reliability: quality.reliability,
      specificity: quality.specificity,
      recency: quality.recency,
      independenceLevel: quality.independenceLevel,
      supportingCount,
      contradictingCount,
    });

    return claimService.setStatus({
      id: claim.id,
      toStatus: report.status,
      confidence: newConfidence,
      actorType: params.actorType,
      actorId: params.actorId,
    });
  },

  /**
   * Rolls every claim's current confidence up into a fresh Opportunity
   * confidence score, weighted by claim importance (§11) — preserves
   * the opportunity's last-known opportunityScore/killRisk unchanged,
   * carried forward into a new, history-preserving OpportunityScoreRecord
   * (§18, §27) rather than fabricating new dimension values. Returns
   * null (no-op) when the opportunity has no claims yet.
   */
  async recalculateOpportunityConfidence(params: RecalculateOpportunityConfidenceParams): Promise<Opportunity | null> {
    const claims = await claimRepository.listForOpportunity(params.opportunityId);
    const claimInputs = claims.map((c) => {
      if (!isClaimImportance(c.importance)) {
        throw new ValidationError(`Corrupt stored importance on claim ${c.id}: ${c.importance}`);
      }
      return { importance: c.importance as ClaimImportance, confidence: c.confidence };
    });
    const aggregate = computeAggregateConfidence(claimInputs);
    if (aggregate === null) return null;

    const scoreRecords = await opportunityRepository.listScoreRecords(params.opportunityId);
    const latest = scoreRecords[0] ?? null;

    await opportunityRepository.addScoreRecord({
      opportunityId: params.opportunityId,
      dimensions: latest?.dimensions ?? toJsonString({}),
      opportunityScore: latest?.opportunityScore ?? 0,
      confidenceScore: aggregate,
      scoredBy: params.scoredBy,
      killRiskScore: latest?.killRiskScore ?? null,
      killRiskDimensions: latest?.killRiskDimensions ?? null,
      killRiskReasons: latest?.killRiskReasons ?? null,
    });

    const updated = await opportunityRepository.update(params.opportunityId, { confidenceScore: aggregate });

    await auditService.record({
      actorType: "SYSTEM",
      actorId: null,
      action: "OPPORTUNITY_CONFIDENCE_RECALCULATED",
      resourceType: "OPPORTUNITY",
      resourceId: params.opportunityId,
      result: "SUCCESS",
      metadata: { confidenceScore: aggregate, claimCount: claims.length },
    });
    await eventBus.publish({
      type: "OPPORTUNITY_SCORED",
      payload: { opportunityId: params.opportunityId, opportunityScore: updated.opportunityScore, confidenceScore: aggregate },
    });

    return updated;
  },
};

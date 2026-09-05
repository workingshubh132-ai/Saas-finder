import type { CompanyRecommendation } from "@prisma/client";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { isBusinessReviewHumanDecision } from "../domain/business-review-memo/business-review-memo.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface RecordCompanyRecommendationDecisionParams {
  companyRecommendationId: string;
  decision: string;
  reason: string | null;
  actor: Actor;
}

/**
 * Records the Human Owner's decision on a `CompanyRecommendation` — the
 * one write `founderDecisionQueueService`/`decisionCardService` surface
 * a `CompanyRecommendation` for but nothing in tasks #201-203 actually
 * performed (`companyRecommendationRepository.recordHumanDecision` had
 * no caller until this). Mirrors every other memo's own
 * `recordHumanDecision` shape (docs/M9_ARCHITECTURE_PROPOSAL.md §33's
 * own "reuses BUSINESS_REVIEW_HUMAN_DECISIONS directly" note) — no
 * CompanyRecommendation-specific decision vocabulary, no new event.
 * Human-actor-gated: the top-level "does the company act on this"
 * decision is the Human Owner's alone (Constitution §8).
 */
export const companyRecommendationService = {
  async recordHumanDecision(params: RecordCompanyRecommendationDecisionParams): Promise<CompanyRecommendation> {
    assertHumanActor(params.actor);
    if (!isBusinessReviewHumanDecision(params.decision)) {
      throw new ValidationError(`Unknown company-recommendation human decision: ${params.decision}`);
    }
    const recommendation = await companyRecommendationRepository.getOrThrow(params.companyRecommendationId);
    if (recommendation.humanDecision !== null) return recommendation; // Idempotent — already decided.

    const updated = await companyRecommendationRepository.recordHumanDecision(params.companyRecommendationId, {
      humanDecision: params.decision,
      humanReason: params.reason,
      decidedByIdentityId: params.actor.actorId ?? "unknown",
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `COMPANY_RECOMMENDATION_DECISION_${params.decision}`,
      resourceType: "COMPANY_RECOMMENDATION",
      resourceId: params.companyRecommendationId,
      result: "SUCCESS",
      metadata: { reason: params.reason },
    });
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "COMPANY_RECOMMENDATION", companyRecommendationId: updated.id, decision: params.decision } });

    return updated;
  },
};

import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { investmentMemoRepository } from "../db/repositories/investment-memo.repository.js";
import { launchReviewMemoRepository } from "../db/repositories/launch-review-memo.repository.js";
import { productReviewMemoRepository } from "../db/repositories/product-review-memo.repository.js";
import { computeFounderAttentionScore, reversibilityFor, type FounderAttentionFactors } from "../domain/attention/attention-score.js";
import type { DecisionQueueEntry } from "../domain/decision-queue/decision-queue.types.js";
import { DEFAULT_APPROVAL_EXPIRY_DAYS } from "../domain/approval/staleness.js";

const RISK_LEVEL_TO_ATTENTION: Readonly<Record<string, number>> = { GREEN: 0, YELLOW: 0.33, ORANGE: 0.66, RED: 1 };
/** Unknown risk is treated as medium (documented), never silently 0 — an un-classified item is never assumed safe. */
const UNKNOWN_RISK_ATTENTION = 0.5;
/** No richer signal exists yet for this factor/source combination (documented simplification, never a silently fabricated "real" number — same discipline as metric-engine.service.ts's own always-0 contraction/expansion note). */
const NEUTRAL_DEFAULT = 0.5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function urgencyFromExpiry(expiresAt: Date | null, now: Date): number {
  if (!expiresAt) return 0;
  const msRemaining = expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) return 1;
  const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);
  return clamp01(1 - daysRemaining / DEFAULT_APPROVAL_EXPIRY_DAYS);
}

/** Re-fetches the real underlying row rather than trusting a summary at face value — the same "independently re-query" discipline every Chairman method already follows. */
async function confidenceFor(entry: DecisionQueueEntry): Promise<number | null> {
  switch (entry.source) {
    case "INVESTMENT_MEMO":
      return (await investmentMemoRepository.findById(entry.id))?.confidence ?? null;
    case "CUSTOMER_DISCOVERY_MEMO":
      return (await customerDiscoveryMemoRepository.findById(entry.id))?.confidence ?? null;
    case "PRODUCT_REVIEW_MEMO":
      return (await productReviewMemoRepository.findById(entry.id))?.confidence ?? null;
    case "LAUNCH_REVIEW_MEMO":
      return (await launchReviewMemoRepository.findById(entry.id))?.confidence ?? null;
    case "BUSINESS_REVIEW_MEMO":
      return (await businessReviewMemoRepository.findById(entry.id))?.confidence ?? null;
    case "COMPANY_RECOMMENDATION":
      return (await companyRecommendationRepository.findById(entry.id))?.confidence ?? null;
    default:
      return null;
  }
}

export interface ScoredEntry {
  readonly entry: DecisionQueueEntry;
  readonly factors: FounderAttentionFactors;
  readonly score: number;
}

/**
 * Applies `computeFounderAttentionScore` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §18) to a real `DecisionQueueEntry` — every factor is either derived
 * from real, already-stored data on the entry itself or the underlying
 * row (risk, urgency, deadlineProximity, uncertainty, reversibility),
 * or a single documented neutral default for the factors this
 * milestone has no cheap real signal for yet (financialImpact,
 * opportunityCost, evidenceQuality, strategicImportance) — never a
 * fabricated "real" number standing in for one.
 */
export const attentionScoringService = {
  async scoreEntry(entry: DecisionQueueEntry): Promise<ScoredEntry> {
    const now = new Date();
    const confidence = await confidenceFor(entry);
    const urgency = urgencyFromExpiry(entry.expiresAt, now);

    const factors: FounderAttentionFactors = {
      financialImpact: NEUTRAL_DEFAULT,
      urgency,
      risk: entry.riskLevel ? (RISK_LEVEL_TO_ATTENTION[entry.riskLevel] ?? UNKNOWN_RISK_ATTENTION) : UNKNOWN_RISK_ATTENTION,
      uncertainty: confidence !== null ? clamp01(1 - confidence) : NEUTRAL_DEFAULT,
      reversibility: 1 - reversibilityFor(entry.source),
      opportunityCost: NEUTRAL_DEFAULT,
      evidenceQuality: NEUTRAL_DEFAULT,
      strategicImportance: NEUTRAL_DEFAULT,
      deadlineProximity: urgency,
    };

    return { entry, factors, score: computeFounderAttentionScore(factors) };
  },

  async scoreAll(entries: readonly DecisionQueueEntry[]): Promise<ScoredEntry[]> {
    const scored = await Promise.all(entries.map((entry) => this.scoreEntry(entry)));
    return [...scored].sort((a, b) => b.score - a.score);
  },
};

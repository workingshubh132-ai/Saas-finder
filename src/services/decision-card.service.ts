import { approvalRepository } from "../db/repositories/approval.repository.js";
import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { companyReviewRepository } from "../db/repositories/company-review.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { investmentMemoRepository } from "../db/repositories/investment-memo.repository.js";
import { launchReviewMemoRepository } from "../db/repositories/launch-review-memo.repository.js";
import { productReviewMemoRepository } from "../db/repositories/product-review-memo.repository.js";
import { reversibilityFor } from "../domain/attention/attention-score.js";
import type { DecisionQueueEntry } from "../domain/decision-queue/decision-queue.types.js";
import { fromJsonString } from "../domain/shared/json.js";

export interface DecisionCardProvenance {
  readonly claimIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly metricIds: readonly string[];
}

/** A pure presentation shape (docs/M9_ARCHITECTURE_PROPOSAL.md §20) — never persisted; a third copy of data already in ApprovalRequest/a memo table would be a duplication risk, not a feature. */
export interface DecisionCard {
  readonly entry: DecisionQueueEntry;
  readonly why: string;
  readonly keyRisk: string | null;
  readonly evidenceCount: number;
  readonly recommendedAction: string | null;
  readonly reversibility: number;
  readonly confidence: number | null;
  readonly provenance: DecisionCardProvenance;
}

const EMPTY_PROVENANCE: DecisionCardProvenance = { claimIds: [], evidenceIds: [], metricIds: [] };

async function cardForMemo(entry: DecisionQueueEntry, memo: { ceoRecommendationId: string; chairmanReviewId: string; confidence: number }): Promise<DecisionCard> {
  const [ceo, chairman] = await Promise.all([
    ceoRecommendationRepository.findById(memo.ceoRecommendationId),
    chairmanReviewRepository.findById(memo.chairmanReviewId),
  ]);

  const objections = chairman ? fromJsonString<string[]>(chairman.objections, []) : [];
  const claimIds = ceo ? fromJsonString<string[]>(ceo.citedClaimIds, []) : [];

  return {
    entry,
    why: ceo?.reasoning ?? entry.summary,
    keyRisk: objections[0] ?? null,
    evidenceCount: claimIds.length,
    recommendedAction: ceo?.action ?? null,
    reversibility: reversibilityFor(entry.source),
    confidence: memo.confidence,
    provenance: { claimIds, evidenceIds: [], metricIds: [] },
  };
}

/**
 * `buildDecisionCard(entry)` (docs/M9_ARCHITECTURE_PROPOSAL.md §20) —
 * computed on demand, every field traced to a real, already-computed
 * row. `[APPROVE] [REJECT] [REVIEW]` are NOT methods on this service:
 * they map to the existing `approvalService.decide`/each memo's own
 * `recordHumanDecision` call for whichever underlying resource this
 * card wraps — this is a view, never a new decision-recording path.
 */
export const decisionCardService = {
  async build(entry: DecisionQueueEntry): Promise<DecisionCard> {
    switch (entry.source) {
      case "INVESTMENT_MEMO": {
        const memo = await investmentMemoRepository.findById(entry.id);
        if (!memo) break;
        const card = await cardForMemo(entry, memo);
        return { ...card, keyRisk: card.keyRisk ?? memo.strongestArgumentAgainst, why: memo.investmentThesis };
      }
      case "CUSTOMER_DISCOVERY_MEMO": {
        const memo = await customerDiscoveryMemoRepository.findById(entry.id);
        if (!memo) break;
        return cardForMemo(entry, memo);
      }
      case "PRODUCT_REVIEW_MEMO": {
        const memo = await productReviewMemoRepository.findById(entry.id);
        if (!memo) break;
        return cardForMemo(entry, memo);
      }
      case "LAUNCH_REVIEW_MEMO": {
        const memo = await launchReviewMemoRepository.findById(entry.id);
        if (!memo) break;
        return cardForMemo(entry, memo);
      }
      case "BUSINESS_REVIEW_MEMO": {
        const memo = await businessReviewMemoRepository.findById(entry.id);
        if (!memo) break;
        return cardForMemo(entry, memo);
      }
      case "COMPANY_RECOMMENDATION": {
        const rec = await companyRecommendationRepository.findById(entry.id);
        if (!rec) break;
        const review = await companyReviewRepository.findLatestForRecommendation(rec.id);
        const objections = review ? fromJsonString<string[]>(review.objections, []) : [];
        const claimIds = fromJsonString<string[]>(rec.citedResourceIds, []);
        return {
          entry,
          why: rec.reasoning,
          keyRisk: objections[0] ?? null,
          evidenceCount: claimIds.length,
          recommendedAction: rec.action,
          reversibility: reversibilityFor(entry.source),
          confidence: rec.confidence,
          provenance: { claimIds, evidenceIds: [], metricIds: [] },
        };
      }
      case "APPROVAL_REQUEST": {
        const approval = await approvalRepository.findById(entry.id);
        if (!approval) break;
        const evidenceIds = fromJsonString<string[]>(approval.evidence, []);
        return {
          entry,
          why: approval.description,
          keyRisk: approval.reason,
          evidenceCount: evidenceIds.length,
          recommendedAction: approval.action,
          reversibility: reversibilityFor(approval.resourceType ?? entry.source),
          confidence: null,
          provenance: { claimIds: [], evidenceIds, metricIds: [] },
        };
      }
    }

    return {
      entry,
      why: entry.summary,
      keyRisk: null,
      evidenceCount: 0,
      recommendedAction: null,
      reversibility: reversibilityFor(entry.source),
      confidence: null,
      provenance: EMPTY_PROVENANCE,
    };
  },

  async buildAll(entries: readonly DecisionQueueEntry[]): Promise<DecisionCard[]> {
    return Promise.all(entries.map((entry) => this.build(entry)));
  },
};

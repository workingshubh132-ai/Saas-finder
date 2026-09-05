import { approvalRepository } from "../db/repositories/approval.repository.js";
import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { investmentMemoRepository } from "../db/repositories/investment-memo.repository.js";
import { launchReviewMemoRepository } from "../db/repositories/launch-review-memo.repository.js";
import { productReviewMemoRepository } from "../db/repositories/product-review-memo.repository.js";
import type { DecisionQueueEntry } from "../domain/decision-queue/decision-queue.types.js";

/**
 * The Human Decision Queue (docs/M9_ARCHITECTURE_PROPOSAL.md §19, M9
 * brief §7) — reuses, aggregates, creates nothing new that decides.
 * Unions three real, already-existing sources at READ TIME, in
 * application code: PENDING ApprovalRequests, the five memo tables
 * with an undecided human decision, and undecided CompanyRecommendations
 * (§31-34). No new table stores a duplicate of any of them.
 *
 * Named `founderDecisionQueueService`, not `decisionQueueService`
 * (docs/DECISIONS.md's own M9 entry): M1 already shipped a
 * `decisionQueueService` (`src/services/decision-queue.service.ts`) —
 * a single-ApprovalRequest enrichment view (evidence + linked
 * opportunity + Chairman review for ONE pending request), a genuinely
 * different, still-used capability (`decisions.routes.ts`, the M1
 * vertical-slice test). This service is the union-across-three-sources
 * one the M9 brief actually asks for; the two coexist rather than one
 * replacing the other.
 */
export const founderDecisionQueueService = {
  async listUndecidedMemos(): Promise<DecisionQueueEntry[]> {
    const [investment, customerDiscovery, productReview, launchReview, businessReview] = await Promise.all([
      investmentMemoRepository.listUndecided(),
      customerDiscoveryMemoRepository.list(),
      productReviewMemoRepository.list(),
      launchReviewMemoRepository.list(),
      businessReviewMemoRepository.list(),
    ]);

    const entries: DecisionQueueEntry[] = [];

    for (const m of investment) {
      entries.push({
        sourceKind: "MEMO",
        source: "INVESTMENT_MEMO",
        id: m.id,
        resourceType: "OPPORTUNITY",
        resourceId: m.opportunityId,
        summary: m.keyReason,
        riskLevel: null,
        createdAt: m.createdAt,
        expiresAt: null,
      });
    }
    for (const m of customerDiscovery) {
      if (m.humanDecision !== null) continue;
      entries.push({
        sourceKind: "MEMO",
        source: "CUSTOMER_DISCOVERY_MEMO",
        id: m.id,
        resourceType: "OPPORTUNITY",
        resourceId: m.opportunityId,
        summary: m.recommendation,
        riskLevel: null,
        createdAt: m.createdAt,
        expiresAt: null,
      });
    }
    for (const m of productReview) {
      if (m.humanDecision !== null) continue;
      entries.push({
        sourceKind: "MEMO",
        source: "PRODUCT_REVIEW_MEMO",
        id: m.id,
        resourceType: "PRODUCT",
        resourceId: m.productId,
        summary: m.recommendation,
        riskLevel: null,
        createdAt: m.createdAt,
        expiresAt: null,
      });
    }
    for (const m of launchReview) {
      if (m.humanDecision !== null) continue;
      entries.push({
        sourceKind: "MEMO",
        source: "LAUNCH_REVIEW_MEMO",
        id: m.id,
        resourceType: "PRODUCT",
        resourceId: m.productId,
        summary: m.recommendation,
        riskLevel: null,
        createdAt: m.createdAt,
        expiresAt: null,
      });
    }
    for (const m of businessReview) {
      if (m.humanDecision !== null) continue;
      entries.push({
        sourceKind: "MEMO",
        source: "BUSINESS_REVIEW_MEMO",
        id: m.id,
        resourceType: "PRODUCT",
        resourceId: m.productId,
        summary: m.recommendation,
        riskLevel: null,
        createdAt: m.createdAt,
        expiresAt: null,
      });
    }

    return entries;
  },

  async listUndecidedCompanyRecommendations(): Promise<DecisionQueueEntry[]> {
    const recs = await companyRecommendationRepository.listUndecided();
    return recs.map((r) => ({
      sourceKind: "COMPANY_RECOMMENDATION" as const,
      source: "COMPANY_RECOMMENDATION" as const,
      id: r.id,
      resourceType: r.targetProductId ? "PRODUCT" : r.targetOpportunityId ? "OPPORTUNITY" : "COMPANY",
      resourceId: r.targetProductId ?? r.targetOpportunityId ?? null,
      summary: r.reasoning,
      riskLevel: r.conflictResolution === "CONFLICTED" ? "RED" : null,
      createdAt: r.createdAt,
      expiresAt: null,
    }));
  },

  async listPending(): Promise<DecisionQueueEntry[]> {
    const [approvals, memoEntries, companyEntries] = await Promise.all([
      approvalRepository.listQueue(),
      this.listUndecidedMemos(),
      this.listUndecidedCompanyRecommendations(),
    ]);

    const approvalEntries: DecisionQueueEntry[] = approvals.map((a) => ({
      sourceKind: "APPROVAL_REQUEST",
      source: "APPROVAL_REQUEST",
      id: a.id,
      resourceType: a.resourceType ?? "UNKNOWN",
      resourceId: a.resourceId,
      summary: a.description,
      riskLevel: a.riskLevel,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    }));

    return [...approvalEntries, ...memoEntries, ...companyEntries];
  },
};

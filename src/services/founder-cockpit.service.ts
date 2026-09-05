import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { companyReviewRepository } from "../db/repositories/company-review.repository.js";
import { founderCockpitViewRepository } from "../db/repositories/founder-cockpit-view.repository.js";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { operatingCycleRepository } from "../db/repositories/operating-cycle.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { CompanyStateDimensions } from "../domain/company-state/company-state.types.js";
import { companyStateService } from "./company-state.service.js";
import { companyTimelineService, type TimelineEntry } from "./company-timeline.service.js";
import type { FounderAttentionQueueItem } from "./founder-attention.service.js";
import { founderAttentionService } from "./founder-attention.service.js";
import { portfolioControlService, type PortfolioOverview } from "./portfolio-control.service.js";

export interface RevenueRankingEntry {
  readonly productId: string;
  readonly mrr: number | null;
  readonly revenueHealth: number | null;
}

export interface UncertainProduct {
  readonly productId: string;
  readonly state: string;
}

export interface FounderCockpit {
  readonly companyState: CompanyStateDimensions;
  readonly currentCycleStage: string | null;
  readonly revenueRanking: readonly RevenueRankingEntry[];
  readonly portfolio: PortfolioOverview;
  readonly uncertainProducts: readonly UncertainProduct[];
  readonly latestCompanyRecommendation: { action: string; reasoning: string; confidence: number } | null;
  readonly latestChairmanConcern: { decision: string; reasoning: string } | null;
  readonly topDecisions: readonly FounderAttentionQueueItem[];
  readonly sinceLastReview: readonly TimelineEntry[];
  readonly recentLessons: readonly { lesson: string | null; createdAt: Date }[];
}

const TOP_DECISION_COUNT = 10;
const RECENT_LESSON_COUNT = 5;

/**
 * `founderCockpitService.getCockpit()` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §44) — answers the brief's own §32 question list directly from
 * already-built pieces, never a paginated "all metrics" dump (§45's
 * own dashboard principle). Recording a view is the only genuinely
 * new persistent state this section needs (`FounderCockpitView`) —
 * everything else is a read.
 */
export const founderCockpitService = {
  async getCockpit(viewedByIdentityId: string): Promise<FounderCockpit> {
    const lastView = await founderCockpitViewRepository.findLatest();

    const [companyState, portfolio, allProducts, activeCycles, latestRecommendation, topDecisions, recentLearningRecords] = await Promise.all([
      companyStateService.getState(),
      portfolioControlService.overview(),
      productRepository.list(),
      operatingCycleRepository.listActive(),
      companyRecommendationRepository.list(),
      founderAttentionService.listQueue(),
      learningRecordRepository.list(),
    ]);

    const liveProducts = allProducts.filter((p) => p.status === "LIVE");
    const perProduct = await Promise.all(
      liveProducts.map(async (product) => {
        const [health, mrr] = await Promise.all([businessHealthRepository.findLatestForProduct(product.id), businessMetricRepository.findLatestForProductByType(product.id, "MRR")]);
        return { product, health, mrr };
      }),
    );

    const revenueRanking = [...perProduct]
      .map((p) => ({ productId: p.product.id, mrr: p.mrr?.value ?? null, revenueHealth: p.health?.revenueHealth ?? null }))
      .sort((a, b) => (b.mrr ?? -Infinity) - (a.mrr ?? -Infinity));

    const uncertainProducts: UncertainProduct[] = perProduct.filter((p) => p.health?.state === "EARLY" || p.health?.state === "UNKNOWN" || !p.health).map((p) => ({ productId: p.product.id, state: p.health?.state ?? "UNKNOWN" }));

    const latest = latestRecommendation[0] ?? null;
    const latestReview = latest ? await companyReviewRepository.findLatestForRecommendation(latest.id) : null;

    const sinceLastReview = await companyTimelineService.getTimeline(lastView?.viewedAt);

    await founderCockpitViewRepository.record(viewedByIdentityId);

    return {
      companyState,
      currentCycleStage: activeCycles[0]?.stage ?? null,
      revenueRanking,
      portfolio,
      uncertainProducts,
      latestCompanyRecommendation: latest ? { action: latest.action, reasoning: latest.reasoning, confidence: latest.confidence } : null,
      latestChairmanConcern: latestReview ? { decision: latestReview.decision, reasoning: latestReview.reasoning } : null,
      topDecisions: topDecisions.slice(0, TOP_DECISION_COUNT),
      sinceLastReview,
      recentLessons: recentLearningRecords.slice(0, RECENT_LESSON_COUNT).map((r) => ({ lesson: r.lesson, createdAt: r.createdAt })),
    };
  },
};

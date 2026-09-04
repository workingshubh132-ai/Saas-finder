import type { PortfolioSnapshot } from "@prisma/client";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { PORTFOLIO_RECOMMENDATIONS_TRIGGERING_CEO_REVIEW, isPortfolioRecommendation } from "../domain/portfolio/portfolio.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { businessReviewMemoService } from "./business-review-memo.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { chairmanService } from "./chairman.service.js";
import { portfolioAnalystService } from "./portfolio-analyst.service.js";
import type { BusinessIntelligenceSummary } from "./business-intelligence.service.js";

export interface AnalyzePortfolioParams {
  agentId: string;
  ceoAgentId: string;
  productIds: readonly string[];
  startedBy: AuthenticatedActor;
}

export interface PortfolioAnalysisSummary {
  runId: string;
  snapshots: PortfolioSnapshot[];
  /** Full CEO -> Chairman -> Memo review for every RETIRE/PIVOT-flagged product — never an autonomous action (docs/M8_ARCHITECTURE_PROPOSAL.md §28). */
  triggeredReviews: BusinessIntelligenceSummary[];
}

function toActor(startedBy: AuthenticatedActor): { actorType: "HUMAN" | "AGENT" | "SYSTEM"; actorId: string } {
  return { actorType: startedBy.type, actorId: startedBy.id };
}

/**
 * The portfolio orchestrator (docs/M8_ARCHITECTURE_PROPOSAL.md §28) —
 * a SEPARATE cross-product entry point from businessIntelligenceService's
 * own per-product one (§34: two orchestrators, not one Cycle wrapper).
 * A RETIRE or PIVOT recommendation for a specific product never itself
 * changes anything — it re-invokes the CEO's own recommendBusinessAction
 * for that exact product (its BusinessHealth already exists from a
 * prior per-product analysis run) and carries it all the way through
 * Chairman review and a BusinessReviewMemo, keeping exactly one
 * governance path rather than a second one that bypasses the CEO.
 */
export const portfolioService = {
  async analyzePortfolio(params: AnalyzePortfolioParams): Promise<PortfolioAnalysisSummary> {
    const outcome = await portfolioAnalystService.run({ agentId: params.agentId, productIds: params.productIds, startedBy: params.startedBy });
    if (outcome.status !== "COMPLETED") {
      throw new ValidationError("Portfolio Analyst did not complete — no portfolio snapshot was produced.");
    }
    const { runId, snapshots } = outcome.result;
    const actor = toActor(params.startedBy);

    const triggeredReviews: BusinessIntelligenceSummary[] = [];
    for (const snapshot of snapshots) {
      if (!isPortfolioRecommendation(snapshot.recommendation) || !PORTFOLIO_RECOMMENDATIONS_TRIGGERING_CEO_REVIEW.has(snapshot.recommendation)) {
        continue;
      }

      const ceoOutcome = await ceoReasoningService.recommendBusinessAction({ agentId: params.ceoAgentId, productId: snapshot.productId, startedBy: params.startedBy });
      if (ceoOutcome.status !== "COMPLETED") continue;

      const { review: chairmanReview } = await chairmanService.reviewBusinessAction({ productId: snapshot.productId, reviewedBy: params.startedBy });
      const health = await businessHealthRepository.findLatestForProduct(snapshot.productId);
      if (!health) continue;

      const memo = await businessReviewMemoService.compile({
        productId: snapshot.productId,
        businessHealth: health,
        ceoRecommendation: ceoOutcome.result.recommendation,
        chairmanReview,
        actor,
      });

      const product = await productRepository.findById(snapshot.productId);
      if (!product) continue;

      triggeredReviews.push({
        product,
        businessHealth: health,
        ceoRecommendation: ceoOutcome.result.recommendation,
        chairmanReview,
        memo,
        stoppedReason: null,
      });
    }

    return { runId, snapshots, triggeredReviews };
  },
};

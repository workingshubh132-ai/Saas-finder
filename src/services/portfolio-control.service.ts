import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { mapBusinessHealthToPortfolioBucket, PORTFOLIO_BUCKETS, type PortfolioBucket } from "../domain/company-state/company-state.types.js";
import { killIntelligenceService } from "./kill-intelligence.service.js";

export interface PortfolioBucketEntry {
  productId: string;
  productStatus: string;
  bucket: PortfolioBucket;
  businessHealthState: string;
  compositeScore: number | null;
  killRiskScore: number | null;
}

export type PortfolioOverview = {
  readonly [K in PortfolioBucket]: readonly PortfolioBucketEntry[];
} & { readonly totalProducts: number };

/**
 * Portfolio Control (docs/M9_ARCHITECTURE_PROPOSAL.md §22, M9 brief
 * §10) — a READ, not a new scoring system: the exact same three M8
 * reads `portfolioAnalystService.run` already performs
 * (BusinessHealth, opportunity kill-risk score, killIntelligenceService),
 * grouped into the six buckets by `mapBusinessHealthToPortfolioBucket`
 * (the identical mapping `buildDevPortfolioAnalystFixture`, M8, already
 * encodes). Never calls the Portfolio Analyst agent, never creates a
 * PortfolioSnapshot row, adds zero model calls.
 */
export const portfolioControlService = {
  async overview(): Promise<PortfolioOverview> {
    const allProducts = await productRepository.list();
    const portfolioProducts = allProducts.filter((p) => p.status === "LIVE" || p.status === "PAUSED");

    const entries: PortfolioBucketEntry[] = await Promise.all(
      portfolioProducts.map(async (product) => {
        const [health, opportunityScores] = await Promise.all([
          businessHealthRepository.findLatestForProduct(product.id),
          opportunityRepository.listScoreRecords(product.opportunityId),
        ]);

        const state = health?.state ?? "UNKNOWN";
        let killRiskScore: number | null = null;
        if (health) {
          killRiskScore = killIntelligenceService.assess({
            priorOpportunityKillRiskScore: opportunityScores[0]?.killRiskScore ?? 0,
            retentionHealth: health.customerHealth,
            revenueHealth: health.revenueHealth,
            growthHealth: health.growthHealth,
            marginHealth: health.marginHealth,
            evidenceConfidence: health.evidenceConfidence,
          }).combinedKillRiskScore;
        }

        return {
          productId: product.id,
          productStatus: product.status,
          bucket: mapBusinessHealthToPortfolioBucket(state),
          businessHealthState: state,
          compositeScore: health?.compositeScore ?? null,
          killRiskScore,
        };
      }),
    );

    const buckets = Object.fromEntries(PORTFOLIO_BUCKETS.map((bucket) => [bucket, entries.filter((e) => e.bucket === bucket)])) as Record<
      PortfolioBucket,
      PortfolioBucketEntry[]
    >;

    return { ...buckets, totalProducts: portfolioProducts.length };
  },
};

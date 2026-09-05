import type { BusinessHealth } from "@prisma/client";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { operatingCycleRepository } from "../db/repositories/operating-cycle.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { CompanyStateDimensions } from "../domain/company-state/company-state.types.js";
import { computed, UNKNOWN, type MetricResult } from "../domain/shared/metric-result.js";
import { founderDecisionQueueService } from "./founder-decision-queue.service.js";
import { killIntelligenceService } from "./kill-intelligence.service.js";

function average(values: readonly number[]): MetricResult {
  if (values.length === 0) return UNKNOWN;
  return computed(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function sum(values: readonly number[]): MetricResult {
  if (values.length === 0) return UNKNOWN;
  return computed(values.reduce((sum, v) => sum + v, 0));
}

interface ProductStateInput {
  mrr: number | null;
  health: BusinessHealth | null;
  killRiskScore: number | null;
}

/**
 * Company State (docs/M9_ARCHITECTURE_PROPOSAL.md §21, M9 brief §9) — a
 * single read aggregating only what M1-M8 already computed, per the
 * proposal's own dimension table. Zero writes, zero model calls, zero
 * new analysis pass — every dimension is an AVG/SUM/COUNT over
 * existing BusinessMetric/BusinessHealth/Product/ApprovalRequest/
 * OperatingCycle rows, or the M8 kill-intelligence formula reused
 * unmodified. "Unknown must remain unknown": every health/financial
 * dimension is a MetricResult, so an empty input set returns UNKNOWN,
 * never a fabricated 0 — only the three real counts (portfolio size,
 * decision backlog, execution backlog) are plain numbers, matching the
 * proposal's own "a real count, never unknown" note for those three.
 */
export const companyStateService = {
  async getState(): Promise<CompanyStateDimensions> {
    const allProducts = await productRepository.list();
    const liveProducts = allProducts.filter((p) => p.status === "LIVE");
    const portfolioProducts = allProducts.filter((p) => p.status === "LIVE" || p.status === "PAUSED");

    const perProduct: ProductStateInput[] = await Promise.all(
      liveProducts.map(async (product) => {
        const [health, mrrMetric, opportunityScores] = await Promise.all([
          businessHealthRepository.findLatestForProduct(product.id),
          businessMetricRepository.findLatestForProductByType(product.id, "MRR"),
          opportunityRepository.listScoreRecords(product.opportunityId),
        ]);

        let killRiskScore: number | null = null;
        if (health) {
          const assessment = killIntelligenceService.assess({
            priorOpportunityKillRiskScore: opportunityScores[0]?.killRiskScore ?? 0,
            retentionHealth: health.customerHealth,
            revenueHealth: health.revenueHealth,
            growthHealth: health.growthHealth,
            marginHealth: health.marginHealth,
            evidenceConfidence: health.evidenceConfidence,
          });
          killRiskScore = assessment.combinedKillRiskScore;
        }

        return { mrr: mrrMetric?.value ?? null, health, killRiskScore };
      }),
    );

    const knownHealth = perProduct.map((p) => p.health).filter((h): h is BusinessHealth => h !== null);
    const knownMrr = perProduct.map((p) => p.mrr).filter((v): v is number => v !== null);
    const knownKillRisk = perProduct.map((p) => p.killRiskScore).filter((v): v is number => v !== null);

    const [decisionQueue, executingCycles] = await Promise.all([
      founderDecisionQueueService.listPending(),
      operatingCycleRepository.list({ stage: "EXECUTING" }),
    ]);

    return {
      // No real payment processor exists anywhere in this codebase (M7 §59) — always UNKNOWN, never estimated.
      cashPosition: UNKNOWN,
      revenue: sum(knownMrr),
      growth: average(knownHealth.map((h) => h.growthHealth)),
      portfolioSize: portfolioProducts.length,
      portfolioHealth: average(knownHealth.map((h) => h.compositeScore)),
      customerHealth: average(knownHealth.map((h) => h.customerHealth)),
      operationalHealth: average(knownHealth.map((h) => h.operationalHealth)),
      risk: average(knownKillRisk),
      evidenceQuality: average(knownHealth.map((h) => h.evidenceConfidence)),
      decisionBacklog: decisionQueue.length,
      executionBacklog: executingCycles.length,
    };
  },
};

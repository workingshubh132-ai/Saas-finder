import { describe, expect, it } from "vitest";
import { businessIntelligenceService } from "../../src/services/business-intelligence.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { portfolioService } from "../../src/services/portfolio.service.js";
import type { OpportunityScoreDimensions } from "../../src/services/opportunity-scorer.js";
import type { KillRiskDimensions } from "../../src/services/kill-risk-scorer.js";
import { authActor, makeLiveProduct, seedActivationDefinition, seedCustomerFeedback, seedRevenueData, seedUsageCohort } from "../helpers.js";

const ELEVATED_SCORE_DIMENSIONS: OpportunityScoreDimensions = {
  pain: 0.3, demand: 0.3, willingnessToPay: 0.2, reachability: 0.3, retention: 0.2, differentiation: 0.2,
  buildability: 0.5, economics: 0.2, risk: 0.8, evidenceQuality: 0.3, marketSize: 0.3, frequency: 0.3,
  evidenceIndependence: 0.3, timing: 0.3,
};
const ELEVATED_KILL_RISK_DIMENSIONS: KillRiskDimensions = {
  weakDemand: 0.9, weakWillingnessToPay: 0.9, crowdedMarket: 0.9, poorDifferentiation: 0.9, badDistribution: 0.9,
  technicalDifficulty: 0.9, regulatoryRisk: 0.9, platformDependency: 0.9, lowRetention: 0.9, lowMargins: 0.9,
  insufficientEvidence: 0.9,
};

/**
 * The portfolio M8 capstone (docs/M8_ARCHITECTURE_PROPOSAL.md §1, §28,
 * M8 brief §19, §55): VentureForge operates multiple products at once
 * and must compare them on Constitution §19's own vocabulary (SCALE /
 * MAINTAIN / INVESTIGATE / PIVOT / PAUSE / RETIRE) — a strong product
 * and a failing one, analyzed together, must receive genuinely
 * different recommendations, and a RETIRE recommendation must trigger
 * the SAME CEO -> Chairman -> BusinessReviewMemo pipeline every other
 * business decision goes through, never a second, bypassing path.
 */
describe("M8 capstone: portfolio — a strong and a failing product receive different recommendations, and RETIRE triggers a real CEO review", () => {
  it("compares two real LIVE products and recommends SCALE for the healthy one, RETIRE (with a full triggered review) for the critical one", async () => {
    const now = new Date();

    // Product A: the same real-strength setup as the positive capstone.
    const chainA = await makeLiveProduct();
    await seedActivationDefinition(chainA.product.id);
    await seedUsageCohort({ productId: chainA.product.id, cohortSize: 10, daysAgoSignedUp: 45, activatedFraction: 0.9, retainedFraction: 0.9, now });
    await seedUsageCohort({ productId: chainA.product.id, cohortSize: 15, daysAgoSignedUp: 10, activatedFraction: 0.9, retainedFraction: 0, now });
    await seedRevenueData(chainA.product.id, [{ monthlyValueUsd: 30, startedDaysAgo: 60 }, { monthlyValueUsd: 30, startedDaysAgo: 60 }, { monthlyValueUsd: 30, startedDaysAgo: 60 }], now);
    await seedCustomerFeedback(chainA.product.id, [
      { excerpt: "Solved our workflow completely.", sentiment: "POSITIVE" },
      { excerpt: "Upgraded seats after two weeks.", sentiment: "POSITIVE" },
      { excerpt: "Exactly what we needed.", sentiment: "POSITIVE" },
    ], now);
    const summaryA = await businessIntelligenceService.analyze({
      productId: chainA.product.id,
      productIntelligenceAgentId: chainA.agents.productIntelligenceAgent.id,
      revenueAnalystAgentId: chainA.agents.revenueAnalystAgent.id,
      growthAnalystAgentId: chainA.agents.growthAnalystAgent.id,
      customerIntelligenceAgentId: chainA.agents.customerIntelligenceAgent.id,
      ceoAgentId: chainA.agents.ceoAgent.id,
      startedBy: authActor(),
    });
    expect(summaryA.businessHealth!.state).toBe("HEALTHY");

    // Product B: the same real-decline setup as the kill capstone, including the elevated opportunity rescore.
    const chainB = await makeLiveProduct();
    await opportunityService.scoreOpportunity({ opportunityId: chainB.product.opportunityId, dimensions: ELEVATED_SCORE_DIMENSIONS, scoredBy: "test-portfolio-rescore", killRiskDimensions: ELEVATED_KILL_RISK_DIMENSIONS });
    await seedActivationDefinition(chainB.product.id);
    await seedUsageCohort({ productId: chainB.product.id, cohortSize: 20, daysAgoSignedUp: 45, activatedFraction: 0.1, retainedFraction: 0, now });
    await seedUsageCohort({ productId: chainB.product.id, cohortSize: 5, daysAgoSignedUp: 10, activatedFraction: 0.1, retainedFraction: 0, now });
    await seedRevenueData(chainB.product.id, [
      { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 10 },
      { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 8 },
      { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 5 },
    ], now);
    await seedCustomerFeedback(chainB.product.id, [
      { excerpt: "Stopped working for us after week two.", sentiment: "NEGATIVE" },
      { excerpt: "Cancelled — unresolved issues.", sentiment: "NEGATIVE" },
      { excerpt: "Support never fixed our core complaint.", sentiment: "NEGATIVE" },
    ], now);
    const summaryB = await businessIntelligenceService.analyze({
      productId: chainB.product.id,
      productIntelligenceAgentId: chainB.agents.productIntelligenceAgent.id,
      revenueAnalystAgentId: chainB.agents.revenueAnalystAgent.id,
      growthAnalystAgentId: chainB.agents.growthAnalystAgent.id,
      customerIntelligenceAgentId: chainB.agents.customerIntelligenceAgent.id,
      ceoAgentId: chainB.agents.ceoAgent.id,
      startedBy: authActor(),
    });
    expect(summaryB.businessHealth!.state).toBe("CRITICAL");

    const portfolio = await portfolioService.analyzePortfolio({
      agentId: chainA.agents.portfolioAnalystAgent.id,
      ceoAgentId: chainA.agents.ceoAgent.id,
      productIds: [chainA.product.id, chainB.product.id],
      startedBy: authActor(),
    });

    expect(portfolio.snapshots).toHaveLength(2);
    const snapshotA = portfolio.snapshots.find((s) => s.productId === chainA.product.id);
    const snapshotB = portfolio.snapshots.find((s) => s.productId === chainB.product.id);
    expect(snapshotA?.recommendation).toBe("SCALE");
    expect(snapshotB?.recommendation).toBe("RETIRE");
    // Every snapshot's runId is shared — one comparison run, not two independent ones.
    expect(snapshotA?.runId).toBe(snapshotB?.runId);

    // RETIRE triggers a real, full CEO -> Chairman -> Memo review for exactly that product — never a bypass.
    expect(portfolio.triggeredReviews).toHaveLength(1);
    const triggered = portfolio.triggeredReviews[0]!;
    expect(triggered.product.id).toBe(chainB.product.id);
    expect(triggered.ceoRecommendation).not.toBeNull();
    expect(triggered.chairmanReview).not.toBeNull();
    expect(triggered.memo).not.toBeNull();
  });
});

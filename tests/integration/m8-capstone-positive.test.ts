import { describe, expect, it } from "vitest";
import { businessIntelligenceService } from "../../src/services/business-intelligence.service.js";
import { businessReviewMemoService } from "../../src/services/business-review-memo.service.js";
import { productService } from "../../src/services/product.service.js";
import { authActor, HUMAN_OWNER, makeLiveProduct, seedActivationDefinition, seedCustomerFeedback, seedRevenueData, seedUsageCohort } from "../helpers.js";

/**
 * The positive M8 capstone (docs/M8_ARCHITECTURE_PROPOSAL.md §1, M8
 * brief §55): a LIVE product with genuinely strong real usage,
 * revenue, growth, and customer signal runs through the full
 * intelligence loop — LIVE PRODUCT -> REAL DATA -> METRICS -> EVIDENCE
 * -> CLAIMS -> ANALYSIS -> CEO -> CHAIRMAN -> HUMAN -> APPROVED ACTION
 * -> NEW DATA — and correctly recognizes a healthy business without
 * ever fabricating a number along the way. Every input below is
 * hand-derived from the real, documented formulas in
 * business-intelligence.service.ts, business-health.types.ts, and
 * kill-intelligence.service.ts — not tuned by trial and error.
 */
describe("M8 capstone: positive — a genuinely healthy LIVE product is recognized and INVEST is recommended", () => {
  it("real strong usage/revenue/growth/customer data produces HEALTHY BusinessHealth, CEO INVEST, and a full auditable memo", async () => {
    const chain = await makeLiveProduct();
    const { agents, product } = chain;
    const now = new Date();

    await seedActivationDefinition(product.id);
    // Older cohort: establishes a real "prior period" for growth comparison, and is old enough (45d) for D30 retention.
    await seedUsageCohort({ productId: product.id, cohortSize: 10, daysAgoSignedUp: 45, activatedFraction: 0.9, retainedFraction: 0.9, now });
    // Newer cohort: real, larger "current period" signups — a genuine, honest growth signal (not asserted, observed).
    await seedUsageCohort({ productId: product.id, cohortSize: 15, daysAgoSignedUp: 10, activatedFraction: 0.9, retainedFraction: 0, now });

    // Three diversified subscriptions — real revenue, no single customer over the 50% revenue-concentration threshold.
    await seedRevenueData(product.id, [{ monthlyValueUsd: 30, startedDaysAgo: 60 }, { monthlyValueUsd: 30, startedDaysAgo: 60 }, { monthlyValueUsd: 30, startedDaysAgo: 60 }], now);

    // Three independent, positive-sentiment respondents — segmentIsStrong requires >= 3 independent sources with zero recurring pain.
    await seedCustomerFeedback(
      product.id,
      [
        { excerpt: "This solved our reconciliation workflow completely.", sentiment: "POSITIVE" },
        { excerpt: "We upgraded seats after two weeks — clear value.", sentiment: "POSITIVE" },
        { excerpt: "Exactly what we needed, no complaints so far.", sentiment: "POSITIVE" },
      ],
      now,
    );

    const summary = await businessIntelligenceService.analyze({
      productId: product.id,
      productIntelligenceAgentId: agents.productIntelligenceAgent.id,
      revenueAnalystAgentId: agents.revenueAnalystAgent.id,
      growthAnalystAgentId: agents.growthAnalystAgent.id,
      customerIntelligenceAgentId: agents.customerIntelligenceAgent.id,
      ceoAgentId: agents.ceoAgent.id,
      startedBy: authActor(),
    });

    expect(summary.stoppedReason).toBeNull();
    expect(summary.businessHealth).not.toBeNull();
    expect(summary.businessHealth!.state).toBe("HEALTHY");
    expect(summary.businessHealth!.risk).toBeLessThan(0.4);
    expect(summary.businessHealth!.compositeScore).toBeGreaterThanOrEqual(0.75);

    expect(summary.ceoRecommendation).not.toBeNull();
    expect(summary.ceoRecommendation!.action).toBe("INVEST");
    // Every CEO recommendation must cite real, verifiable claim ids — never a bare assertion.
    expect(JSON.parse(summary.ceoRecommendation!.citedClaimIds).length).toBeGreaterThan(0);

    expect(summary.chairmanReview).not.toBeNull();
    expect(summary.memo).not.toBeNull();
    expect(summary.memo!.recommendation).toBe("INVEST");
    expect(summary.memo!.humanDecision).toBeNull();

    // Close the loop with a real human decision — INVEST is strategic guidance, never itself a spend, so the product stays LIVE.
    const decided = await businessReviewMemoService.recordHumanDecision({ memoId: summary.memo!.id, humanDecision: "APPROVE", humanReason: "Strong real signal across the board — continue investing.", actor: HUMAN_OWNER });
    expect(decided.humanDecision).toBe("APPROVE");
    const finalProduct = await productService.getOrThrow(product.id);
    expect(finalProduct.status).toBe("LIVE");
  });
});

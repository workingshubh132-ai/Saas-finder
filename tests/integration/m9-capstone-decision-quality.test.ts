import { describe, expect, it } from "vitest";
import { decisionQualityService } from "../../src/services/decision-quality.service.js";
import { predictionOutcomeService } from "../../src/services/prediction-outcome.service.js";
import { makeLiveProduct } from "../helpers.js";

/**
 * M9 capstone: the Decision Quality Dashboard composes real calibration
 * data from every decision type into one view (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §29) — "track calibration and uncertainty, not just being right."
 * makeLiveProduct()'s own real factory chain already produces two
 * genuinely decided memos (a ProductReviewMemo and a LaunchReviewMemo,
 * both real human APPROVE decisions) as a side effect of reaching LIVE
 * — this capstone confirms both surface here, a fresh resolved
 * PredictionOutcome surfaces under its own source, and the axes with no
 * real data this run (investment, customer discovery, business
 * decisions) report an honest zero rather than a fabricated number.
 */
describe("M9 capstone: Decision Quality Dashboard composes real, multi-axis calibration data, never fabricating an axis with nothing behind it", () => {
  it("productBuilds and launch reflect makeLiveProduct()'s own real decided memos; predictionAccuracyBySource reflects a real resolved prediction; empty axes report zero honestly", async () => {
    const chain = await makeLiveProduct();

    const targetStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const targetEnd = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const prediction = await predictionOutcomeService.record({
      productId: chain.product.id,
      metricType: "MRR",
      predictedValue: 2000,
      targetPeriodStart: targetStart,
      targetPeriodEnd: targetEnd,
      predictionSource: "CAPSTONE_TEST_SOURCE",
      now: targetStart,
    });
    await predictionOutcomeService.resolve({ predictionOutcomeId: prediction.id, observedValue: 1800, now: new Date() });

    const dashboard = await decisionQualityService.getDashboard();

    expect(dashboard.productBuilds.totalDecisions).toBeGreaterThan(0);
    expect(dashboard.launch.totalDecisions).toBeGreaterThan(0);

    const predictionBucket = dashboard.predictionAccuracyBySource.find((b) => b.source === "CAPSTONE_TEST_SOURCE");
    expect(predictionBucket).toBeDefined();
    expect(predictionBucket!.count).toBe(1);
    expect(predictionBucket!.avgAbsErrorPct).not.toBeNull();

    // Honest zero, never fabricated: no InvestmentMemo/CustomerDiscoveryMemo/BusinessReviewMemo was decided this run.
    expect(dashboard.investment.totalDecisions).toBe(0);
    expect(dashboard.customerDiscovery.totalDecisions).toBe(0);
    expect(dashboard.businessDecisions.totalDecisions).toBe(0);
  });
});

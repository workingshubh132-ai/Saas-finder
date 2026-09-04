import { describe, expect, it } from "vitest";
import { computeActivationRate, MIN_ACTIVATION_SAMPLE } from "../../src/domain/product-intelligence/activation.js";
import { computeRetention, MIN_RETENTION_COHORT, type RetentionCohortMember } from "../../src/domain/product-intelligence/retention.js";
import {
  computeGrossRevenueRetention,
  computeLogoChurn,
  computeNetRevenueRetention,
  computeRevenueChurn,
  MIN_CHURN_SAMPLE,
  type SubscriptionPeriodDelta,
} from "../../src/domain/revenue-intelligence/churn.js";
import { computeRevenueMetrics } from "../../src/domain/revenue-intelligence/revenue-metrics.js";
import { computeCostBreakdown } from "../../src/domain/revenue-intelligence/cost-metrics.js";
import { computeUnitEconomics, MIN_LTV_HISTORY_MONTHS } from "../../src/domain/revenue-intelligence/unit-economics.js";
import { checkRevenueConcentration, REVENUE_CONCENTRATION_THRESHOLD } from "../../src/domain/revenue-intelligence/concentration.js";
import { detectAnomaly, MIN_BASELINE_PERIODS } from "../../src/domain/anomaly/anomaly.types.js";
import { deriveBusinessHealth } from "../../src/domain/business-health/business-health.types.js";
import { buildCohorts } from "../../src/domain/cohort/cohort.types.js";
import { GROWTH_EXPERIMENT_TRANSITIONS } from "../../src/domain/growth-experiment/growth-experiment.types.js";
import { assertPredictionIsForward, assertResolutionNotPremature, computePredictionErrorPct } from "../../src/domain/prediction/prediction-outcome.types.js";
import { shouldGenerateLearningRecord, LEARNING_RECORD_ERROR_THRESHOLD } from "../../src/domain/learning/learning-record.types.js";
import { computeBusinessActionPriorityScore } from "../../src/domain/decision/business-action.types.js";
import { assertMetricProvenance } from "../../src/domain/business-metric/business-metric.types.js";
import { checkMetricValueQuality, findDuplicateKeys, isStale } from "../../src/domain/shared/data-quality.js";
import { assertTransition } from "../../src/domain/shared/state-machine.js";
import { killIntelligenceService } from "../../src/services/kill-intelligence.service.js";

describe("computeActivationRate", () => {
  it("returns INSUFFICIENT_DATA below the minimum sample", () => {
    const result = computeActivationRate({ signupCount: MIN_ACTIVATION_SAMPLE - 1, activatedCount: 1 });
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("computes a real rate at or above the minimum sample", () => {
    const result = computeActivationRate({ signupCount: 10, activatedCount: 4 });
    expect(result).toEqual({ status: "COMPUTED", value: 0.4 });
  });

  it("rejects an impossible activatedCount > signupCount", () => {
    expect(() => computeActivationRate({ signupCount: 5, activatedCount: 6 })).toThrow();
  });
});

describe("computeRetention", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("is INSUFFICIENT_DATA when the window hasn't elapsed for enough members yet — never a manufactured low number", () => {
    const members: RetentionCohortMember[] = Array.from({ length: 10 }, () => ({
      signedUpAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000), // only 12 days ago, D30 not eligible
      lastActiveAt: null,
    }));
    const result = computeRetention("D30", members, now);
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("is INSUFFICIENT_DATA below MIN_RETENTION_COHORT even when the window has elapsed", () => {
    const members: RetentionCohortMember[] = Array.from({ length: MIN_RETENTION_COHORT - 1 }, () => ({
      signedUpAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
      lastActiveAt: null,
    }));
    const result = computeRetention("D30", members, now);
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("computes a real retention rate once eligible and large enough", () => {
    const signedUpAt = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
    const members: RetentionCohortMember[] = [
      ...Array.from({ length: 3 }, () => ({ signedUpAt, lastActiveAt: new Date(signedUpAt.getTime() + 31 * 24 * 60 * 60 * 1000) })),
      ...Array.from({ length: 7 }, () => ({ signedUpAt, lastActiveAt: null })),
    ];
    const result = computeRetention("D30", members, now);
    expect(result).toMatchObject({ status: "COMPUTED", cohortSize: 10, retainedCount: 3, retentionRate: 0.3 });
  });
});

describe("churn metrics — kept structurally separate", () => {
  const delta: SubscriptionPeriodDelta = { startingActiveCount: 20, startingMrr: 2000, cancelledCount: 2, churnedMrr: 200, contractedMrr: 50, expansionMrr: 100 };

  it("computes logo churn as a fraction of accounts, not revenue", () => {
    expect(computeLogoChurn(delta)).toEqual({ status: "COMPUTED", value: 0.1 });
  });
  it("computes revenue churn independently of logo churn", () => {
    expect(computeRevenueChurn(delta)).toEqual({ status: "COMPUTED", value: 0.1 });
  });
  it("computes gross revenue retention distinctly from net", () => {
    const grr = computeGrossRevenueRetention(delta);
    const nrr = computeNetRevenueRetention(delta);
    expect(grr).toEqual({ status: "COMPUTED", value: (2000 - 200 - 50) / 2000 });
    expect(nrr).toEqual({ status: "COMPUTED", value: (2000 - 200 - 50 + 100) / 2000 });
    expect(grr).not.toEqual(nrr);
  });
  it("is INSUFFICIENT_DATA below MIN_CHURN_SAMPLE", () => {
    const thin: SubscriptionPeriodDelta = { ...delta, startingActiveCount: MIN_CHURN_SAMPLE - 1 };
    expect(computeLogoChurn(thin).status).toBe("INSUFFICIENT_DATA");
  });
  it("never divides by zero starting MRR", () => {
    const zero: SubscriptionPeriodDelta = { ...delta, startingMrr: 0 };
    expect(computeRevenueChurn(zero).status).toBe("INSUFFICIENT_DATA");
  });
});

describe("computeRevenueMetrics", () => {
  it("sums MRR from real subscriptions and derives ARR/ARPU", () => {
    const result = computeRevenueMetrics({
      activeSubscriptions: [{ id: "a", monthlyValueUsd: 100 }, { id: "b", monthlyValueUsd: 50 }],
      newMrr: 10,
      expansionMrr: 0,
      contractionMrr: 0,
      churnedMrr: 0,
      refundsUsd: 0,
    });
    expect(result.mrr).toEqual({ status: "COMPUTED", value: 150 });
    expect(result.arr).toEqual({ status: "COMPUTED", value: 1800 });
    expect(result.arpu).toEqual({ status: "COMPUTED", value: 75 });
  });
  it("ARPU is undefined with zero active subscriptions, never a divide-by-zero", () => {
    const result = computeRevenueMetrics({ activeSubscriptions: [], newMrr: 0, expansionMrr: 0, contractionMrr: 0, churnedMrr: 0, refundsUsd: 0 });
    expect(result.arpu.status).toBe("INSUFFICIENT_DATA");
  });
});

describe("computeCostBreakdown", () => {
  it("separates fixed/variable and observed/estimated independently", () => {
    const result = computeCostBreakdown([
      { category: "INFRASTRUCTURE", nature: "FIXED", amountUsd: 50, observed: true },
      { category: "AI_MODEL_USAGE", nature: "VARIABLE", amountUsd: 20, observed: true },
      { category: "SUPPORT", nature: "VARIABLE", amountUsd: 30, observed: false },
    ]);
    expect(result.totalUsd).toBe(100);
    expect(result.fixedUsd).toBe(50);
    expect(result.variableUsd).toBe(50);
    expect(result.observedUsd).toBe(70);
    expect(result.estimatedUsd).toBe(30);
  });
});

describe("computeUnitEconomics — never fabricate CAC or LTV", () => {
  it("CAC is the literal UNKNOWN when acquisition spend isn't tracked at all", () => {
    const result = computeUnitEconomics({
      arpuUsd: { status: "COMPUTED", value: 50 },
      grossMarginPct: { status: "COMPUTED", value: 0.6 },
      totalAcquisitionSpendUsd: null,
      newCustomersInPeriod: 5,
      retentionHistoryMonths: 6,
      avgCustomerLifespanMonths: { status: "COMPUTED", value: 12 },
    });
    expect(result.cac).toEqual({ status: "UNKNOWN" });
    expect(result.ltvToCac).toEqual({ status: "UNKNOWN" });
  });

  it("LTV is INSUFFICIENT_DATA below MIN_LTV_HISTORY_MONTHS, never a real number from thin history", () => {
    const result = computeUnitEconomics({
      arpuUsd: { status: "COMPUTED", value: 50 },
      grossMarginPct: { status: "COMPUTED", value: 0.6 },
      totalAcquisitionSpendUsd: 1000,
      newCustomersInPeriod: 5,
      retentionHistoryMonths: MIN_LTV_HISTORY_MONTHS - 1,
      avgCustomerLifespanMonths: { status: "COMPUTED", value: 12 },
    });
    expect(result.ltv.status).toBe("INSUFFICIENT_DATA");
  });

  it("computes real CAC/LTV/LTV:CAC/payback once every input is real", () => {
    const result = computeUnitEconomics({
      arpuUsd: { status: "COMPUTED", value: 50 },
      grossMarginPct: { status: "COMPUTED", value: 0.5 },
      totalAcquisitionSpendUsd: 500,
      newCustomersInPeriod: 5,
      retentionHistoryMonths: 6,
      avgCustomerLifespanMonths: { status: "COMPUTED", value: 10 },
    });
    expect(result.cac).toEqual({ status: "COMPUTED", value: 100 });
    expect(result.ltv).toEqual({ status: "COMPUTED", value: 250 });
    expect(result.ltvToCac).toEqual({ status: "COMPUTED", value: 2.5 });
    expect(result.paybackPeriodMonths).toEqual({ status: "COMPUTED", value: 4 });
  });
});

describe("checkRevenueConcentration", () => {
  it("flags concentration at or above the threshold", () => {
    const result = checkRevenueConcentration([900, 50, 50]);
    expect(result.topShare).toBeCloseTo(0.9);
    expect(result.isConcentrated).toBe(true);
    expect(result.topShare).toBeGreaterThanOrEqual(REVENUE_CONCENTRATION_THRESHOLD);
  });
  it("does not flag broad-based revenue", () => {
    const result = checkRevenueConcentration([25, 25, 25, 25]);
    expect(result.isConcentrated).toBe(false);
  });
  it("never divides by zero with no subscriptions", () => {
    expect(checkRevenueConcentration([])).toEqual({ isConcentrated: false, topShare: 0 });
  });
});

describe("detectAnomaly", () => {
  it("declares no anomaly below MIN_BASELINE_PERIODS — insufficient history is the honest answer", () => {
    const result = detectAnomaly({ trailingValues: Array(MIN_BASELINE_PERIODS - 1).fill(100), latestValue: 500 });
    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBeNull();
  });
  it("flags a real DROP crossing the z-score threshold", () => {
    const result = detectAnomaly({ trailingValues: [100, 102, 98, 101, 99], latestValue: 20 });
    expect(result.isAnomaly).toBe(true);
    expect(result.direction).toBe("DROP");
  });
  it("flags a real SPIKE crossing the z-score threshold", () => {
    const result = detectAnomaly({ trailingValues: [100, 102, 98, 101, 99], latestValue: 500 });
    expect(result.isAnomaly).toBe(true);
    expect(result.direction).toBe("SPIKE");
  });
  it("does not flag ordinary variation", () => {
    // baseline mean=100, stdDev=sqrt(2)≈1.414; latestValue=101 gives z≈0.71, well under the 2.0 threshold.
    const result = detectAnomaly({ trailingValues: [100, 102, 98, 101, 99], latestValue: 101 });
    expect(result.isAnomaly).toBe(false);
  });
});

describe("deriveBusinessHealth — every state has a real, named threshold", () => {
  it("classifies EARLY below the evidence-confidence floor regardless of raw scores", () => {
    const result = deriveBusinessHealth({ productHealth: 0.9, customerHealth: 0.9, revenueHealth: 0.9, growthHealth: 0.9, marginHealth: 0.9, operationalHealth: 0.9, risk: 0.1, evidenceConfidence: 0.1 });
    expect(result.state).toBe("EARLY");
  });
  it("classifies HEALTHY for strong, low-risk dimensions", () => {
    const result = deriveBusinessHealth({ productHealth: 0.9, customerHealth: 0.9, revenueHealth: 0.9, growthHealth: 0.9, marginHealth: 0.9, operationalHealth: 0.9, risk: 0.1, evidenceConfidence: 0.9 });
    expect(result.state).toBe("HEALTHY");
  });
  it("classifies CRITICAL for weak, high-risk dimensions", () => {
    const result = deriveBusinessHealth({ productHealth: 0.1, customerHealth: 0.1, revenueHealth: 0.1, growthHealth: 0.1, marginHealth: 0.1, operationalHealth: 0.1, risk: 0.9, evidenceConfidence: 0.9 });
    expect(result.state).toBe("CRITICAL");
  });
  it("preserves every underlying dimension alongside the composite score — never collapses to one number", () => {
    const dims = { productHealth: 0.5, customerHealth: 0.6, revenueHealth: 0.7, growthHealth: 0.4, marginHealth: 0.3, operationalHealth: 0.8, risk: 0.3, evidenceConfidence: 0.6 };
    const result = deriveBusinessHealth(dims);
    expect(result.dimensions).toEqual(dims);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
  it("rejects a dimension outside [0, 1]", () => {
    expect(() => deriveBusinessHealth({ productHealth: 1.5, customerHealth: 0.5, revenueHealth: 0.5, growthHealth: 0.5, marginHealth: 0.5, operationalHealth: 0.5, risk: 0.5, evidenceConfidence: 0.5 })).toThrow();
  });
});

describe("buildCohorts", () => {
  it("only proposes a dimension split when at least two distinct values exist", () => {
    expect(buildCohorts("p1", "ACQUISITION_CHANNEL", ["organic"])).toEqual([]);
  });
  it("proposes real cohorts for genuinely distinct values", () => {
    const result = buildCohorts("p1", "ACQUISITION_CHANNEL", ["organic", "referral", "organic"]);
    expect(result.map((c) => c.dimensionValue).sort()).toEqual(["organic", "referral"]);
  });
});

describe("GrowthExperiment state machine", () => {
  it("never allows an experiment to skip straight to RUNNING without approval", () => {
    expect(() => assertTransition("GrowthExperiment", GROWTH_EXPERIMENT_TRANSITIONS, "DRAFT", "RUNNING")).toThrow();
  });
  it("allows the real, documented path", () => {
    expect(() => assertTransition("GrowthExperiment", GROWTH_EXPERIMENT_TRANSITIONS, "APPROVED", "RUNNING")).not.toThrow();
  });
  it("allows a completed experiment to be analyzed again with real results", () => {
    expect(() => assertTransition("GrowthExperiment", GROWTH_EXPERIMENT_TRANSITIONS, "COMPLETED", "ANALYZED")).not.toThrow();
  });
});

describe("prediction tracking — Constitution §23", () => {
  it("rejects a prediction whose target period isn't actually in the future", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(() => assertPredictionIsForward(now, now)).toThrow();
  });
  it("accepts a genuinely forward-looking prediction", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(() => assertPredictionIsForward(now, new Date("2026-07-01T00:00:00Z"))).not.toThrow();
  });
  it("refuses to resolve a prediction before its target period has elapsed — no future-information leakage", () => {
    const targetEnd = new Date("2026-07-01T00:00:00Z");
    expect(() => assertResolutionNotPremature(targetEnd, new Date("2026-06-15T00:00:00Z"))).toThrow();
    expect(() => assertResolutionNotPremature(targetEnd, new Date("2026-07-02T00:00:00Z"))).not.toThrow();
  });
  it("computes relative error, undefined (not Infinity) when predictedValue is exactly zero", () => {
    expect(computePredictionErrorPct(100, 150)).toBeCloseTo(0.5);
    expect(computePredictionErrorPct(0, 0)).toBe(0);
    expect(computePredictionErrorPct(0, 50)).toBeNull();
  });
});

describe("shouldGenerateLearningRecord", () => {
  it("triggers only above the documented threshold", () => {
    expect(shouldGenerateLearningRecord(LEARNING_RECORD_ERROR_THRESHOLD + 0.01)).toBe(true);
    expect(shouldGenerateLearningRecord(LEARNING_RECORD_ERROR_THRESHOLD - 0.01)).toBe(false);
    expect(shouldGenerateLearningRecord(null)).toBe(false);
  });
});

describe("computeBusinessActionPriorityScore", () => {
  it("rewards strong health and penalizes risk, never a bare revenue sort", () => {
    const strong = computeBusinessActionPriorityScore({ revenueHealth: 0.9, growthHealth: 0.9, customerHealth: 0.9, marginHealth: 0.9, evidenceConfidence: 0.9, risk: 0.1 });
    const weak = computeBusinessActionPriorityScore({ revenueHealth: 0.2, growthHealth: 0.2, customerHealth: 0.2, marginHealth: 0.2, evidenceConfidence: 0.2, risk: 0.9 });
    expect(strong).toBeGreaterThan(weak);
  });
});

describe("assertMetricProvenance", () => {
  it("rejects OBSERVED paired with a non-provider source", () => {
    expect(() => assertMetricProvenance({ valueKind: "OBSERVED", source: "MANUAL_ENTRY" })).toThrow();
  });
  it("accepts OBSERVED paired with a real provider source", () => {
    expect(() => assertMetricProvenance({ valueKind: "OBSERVED", source: "REVENUE_PROVIDER" })).not.toThrow();
  });
  it("requires INFERRED to cite at least one input metric id", () => {
    expect(() => assertMetricProvenance({ valueKind: "INFERRED", source: "DETERMINISTIC_CALCULATION", inputMetricIds: [] })).toThrow();
    expect(() => assertMetricProvenance({ valueKind: "INFERRED", source: "DETERMINISTIC_CALCULATION", inputMetricIds: ["m1"] })).not.toThrow();
  });
});

describe("data quality checks", () => {
  it("flags a metric that can never legitimately be negative", () => {
    expect(checkMetricValueQuality("MRR", -5)?.type).toBe("IMPOSSIBLE_VALUE");
  });
  it("flags a rate outside [0, 1]", () => {
    expect(checkMetricValueQuality("CONVERSION_RATE", 1.5)?.type).toBe("IMPOSSIBLE_VALUE");
  });
  it("passes a plausible value", () => {
    expect(checkMetricValueQuality("MRR", 500)).toBeNull();
  });
  it("finds real duplicate keys", () => {
    expect(findDuplicateKeys(["a", "b", "a", "c", "b"]).sort()).toEqual(["a", "b"]);
  });
  it("treats old data as stale", () => {
    const recordedAt = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-06-03T00:00:00Z");
    expect(isStale(recordedAt, now)).toBe(true);
    expect(isStale(recordedAt, new Date("2026-06-01T01:00:00Z"))).toBe(false);
  });
});

describe("killIntelligenceService.assess — reuses M4's real scorer, combined with observed post-launch evidence", () => {
  it("recommends CONTINUE for a genuinely healthy product", () => {
    const result = killIntelligenceService.assess({ priorOpportunityKillRiskScore: 0.1, retentionHealth: 0.9, revenueHealth: 0.9, growthHealth: 0.9, marginHealth: 0.9, evidenceConfidence: 0.9 });
    expect(result.recommendation).toBe("CONTINUE");
  });
  it("recommends PREPARE_KILL_REVIEW for a genuinely failing product", () => {
    const result = killIntelligenceService.assess({ priorOpportunityKillRiskScore: 0.8, retentionHealth: 0.05, revenueHealth: 0.05, growthHealth: 0.05, marginHealth: 0.05, evidenceConfidence: 0.9 });
    expect(result.recommendation).toBe("PREPARE_KILL_REVIEW");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
  it("weighs observed post-launch reality more heavily than a stale pre-launch projection", () => {
    const goodNow = killIntelligenceService.assess({ priorOpportunityKillRiskScore: 0.9, retentionHealth: 0.95, revenueHealth: 0.95, growthHealth: 0.95, marginHealth: 0.95, evidenceConfidence: 0.95 });
    expect(goodNow.recommendation).not.toBe("PREPARE_KILL_REVIEW");
  });
});

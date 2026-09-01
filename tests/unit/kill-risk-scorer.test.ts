import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/shared/errors.js";
import { DeterministicKillRiskScorer, type KillRiskDimensions } from "../../src/services/kill-risk-scorer.js";

const low: KillRiskDimensions = {
  weakDemand: 0.1,
  weakWillingnessToPay: 0.1,
  crowdedMarket: 0.1,
  poorDifferentiation: 0.1,
  badDistribution: 0.1,
  technicalDifficulty: 0.1,
  regulatoryRisk: 0.1,
  platformDependency: 0.1,
  lowRetention: 0.1,
  lowMargins: 0.1,
  insufficientEvidence: 0.1,
};

const high: KillRiskDimensions = {
  weakDemand: 0.9,
  weakWillingnessToPay: 0.9,
  crowdedMarket: 0.9,
  poorDifferentiation: 0.9,
  badDistribution: 0.9,
  technicalDifficulty: 0.9,
  regulatoryRisk: 0.9,
  platformDependency: 0.9,
  lowRetention: 0.9,
  lowMargins: 0.9,
  insufficientEvidence: 0.9,
};

describe("DeterministicKillRiskScorer", () => {
  const scorer = new DeterministicKillRiskScorer();

  it("produces a score within [0, 1]", () => {
    const result = scorer.score(high);
    expect(result.killRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.killRiskScore).toBeLessThanOrEqual(1);
  });

  it("scores uniformly-high risk dimensions higher than uniformly-low ones", () => {
    expect(scorer.score(high).killRiskScore).toBeGreaterThan(scorer.score(low).killRiskScore);
  });

  it("names every dimension crossing the high-risk threshold as an explicit reason — never a bare number", () => {
    const result = scorer.score(high);
    expect(result.killRiskReasons.length).toBe(11); // every dimension is 0.9, all above threshold
    expect(result.killRiskReasons.some((reason) => reason.includes("crowded market"))).toBe(true);
  });

  it("names zero reasons when nothing crosses the threshold", () => {
    const result = scorer.score(low);
    expect(result.killRiskReasons).toHaveLength(0);
  });

  it("rejects a dimension outside [0, 1]", () => {
    expect(() => scorer.score({ ...low, weakDemand: 1.5 })).toThrow(ValidationError);
  });
});

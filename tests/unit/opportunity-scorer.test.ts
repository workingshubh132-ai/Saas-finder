import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/shared/errors.js";
import { DeterministicOpportunityScorer, type OpportunityScoreDimensions } from "../../src/services/opportunity-scorer.js";

const strong: OpportunityScoreDimensions = {
  pain: 0.9,
  demand: 0.9,
  willingnessToPay: 0.9,
  reachability: 0.8,
  retention: 0.8,
  differentiation: 0.7,
  buildability: 0.8,
  economics: 0.8,
  risk: 0.1,
  evidenceQuality: 0.9,
  marketSize: 0.8,
  frequency: 0.8,
  evidenceIndependence: 0.7,
  timing: 0.7,
};

const weak: OpportunityScoreDimensions = {
  pain: 0.2,
  demand: 0.1,
  willingnessToPay: 0.1,
  reachability: 0.2,
  retention: 0.1,
  differentiation: 0.1,
  buildability: 0.3,
  economics: 0.2,
  risk: 0.9,
  evidenceQuality: 0.2,
  marketSize: 0.2,
  frequency: 0.1,
  evidenceIndependence: 0.1,
  timing: 0.2,
};

describe("DeterministicOpportunityScorer", () => {
  const scorer = new DeterministicOpportunityScorer();

  it("produces scores within [0, 1]", () => {
    const result = scorer.score({ dimensions: strong, scoredBy: "test" });
    expect(result.opportunityScore).toBeGreaterThanOrEqual(0);
    expect(result.opportunityScore).toBeLessThanOrEqual(1);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("scores a strong opportunity higher than a weak one", () => {
    const strongResult = scorer.score({ dimensions: strong, scoredBy: "test" });
    const weakResult = scorer.score({ dimensions: weak, scoredBy: "test" });
    expect(strongResult.opportunityScore).toBeGreaterThan(weakResult.opportunityScore);
  });

  it("confidence score is the average of evidence quality and evidence independence (M3)", () => {
    const result = scorer.score({ dimensions: strong, scoredBy: "test" });
    expect(result.confidenceScore).toBeCloseTo((strong.evidenceQuality + strong.evidenceIndependence) / 2);
  });

  it("discounts opportunity score by risk", () => {
    const lowRisk = scorer.score({ dimensions: { ...strong, risk: 0 }, scoredBy: "test" });
    const highRisk = scorer.score({ dimensions: { ...strong, risk: 1 }, scoredBy: "test" });
    expect(highRisk.opportunityScore).toBeLessThan(lowRisk.opportunityScore);
  });

  it("rejects a dimension outside [0, 1]", () => {
    expect(() => scorer.score({ dimensions: { ...strong, pain: 1.5 }, scoredBy: "test" })).toThrow(ValidationError);
    expect(() => scorer.score({ dimensions: { ...strong, risk: -0.1 }, scoredBy: "test" })).toThrow(ValidationError);
  });
});

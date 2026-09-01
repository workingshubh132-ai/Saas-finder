import { describe, expect, it } from "vitest";
import { computeQueuePriority } from "../../src/domain/research-queue/priority.js";

describe("computeQueuePriority", () => {
  it("a high-information-gain gap on a promising, low-risk opportunity outranks a low-gain gap on the same opportunity", () => {
    const base = { opportunityScore: 0.7, killRiskScore: 0.2, estimatedResearchCost: 0.3 };
    const highGain = computeQueuePriority({ ...base, informationGain: 0.9 });
    const lowGain = computeQueuePriority({ ...base, informationGain: 0.1 });
    expect(highGain).toBeGreaterThan(lowGain);
  });

  it("resolving the single biggest uncertainty on a promising opportunity can outrank blindly deepening the highest-scoring one (Part 30)", () => {
    // A modest-scoring opportunity with one large, resolvable uncertainty...
    const uncertainButPromising = computeQueuePriority({ informationGain: 0.9, opportunityScore: 0.5, killRiskScore: 0.1, estimatedResearchCost: 0.2 });
    // ...vs. the highest-scoring opportunity, but with only a marginal, already-mostly-resolved gap.
    const highestScoringMarginalGap = computeQueuePriority({ informationGain: 0.1, opportunityScore: 0.95, killRiskScore: 0.1, estimatedResearchCost: 0.2 });
    expect(uncertainButPromising).toBeGreaterThan(highestScoringMarginalGap);
  });

  it("higher kill risk lowers priority", () => {
    const base = { informationGain: 0.5, opportunityScore: 0.5, estimatedResearchCost: 0.2 };
    const lowRisk = computeQueuePriority({ ...base, killRiskScore: 0.1 });
    const highRisk = computeQueuePriority({ ...base, killRiskScore: 0.9 });
    expect(lowRisk).toBeGreaterThan(highRisk);
  });

  it("can go negative for a costly, unpromising, high-risk item — never floored to 0", () => {
    const priority = computeQueuePriority({ informationGain: 0.1, opportunityScore: 0.1, killRiskScore: 0.95, estimatedResearchCost: 1 });
    expect(priority).toBeLessThan(0);
  });
});

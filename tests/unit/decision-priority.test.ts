import { describe, expect, it } from "vitest";
import { computeDecisionPriority, PLACEHOLDER_NEUTRAL_SCORE } from "../../src/domain/decision/priority.js";

const BASE = {
  opportunityScore: 0.5,
  confidenceScore: 0.5,
  killRiskScore: 0.3,
  topEvidenceGapImpactScore: 0.3,
  maxClaimEIG: 0.3,
  estimatedResearchCost: PLACEHOLDER_NEUTRAL_SCORE,
  timeSensitivityScore: PLACEHOLDER_NEUTRAL_SCORE,
  strategicFitScore: PLACEHOLDER_NEUTRAL_SCORE,
};

describe("computeDecisionPriority", () => {
  it("higher opportunity score raises priority", () => {
    const low = computeDecisionPriority({ ...BASE, opportunityScore: 0.2 });
    const high = computeDecisionPriority({ ...BASE, opportunityScore: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("lower confidence raises priority — more worth resolving", () => {
    const confident = computeDecisionPriority({ ...BASE, confidenceScore: 0.9 });
    const uncertain = computeDecisionPriority({ ...BASE, confidenceScore: 0.1 });
    expect(uncertain).toBeGreaterThan(confident);
  });

  it("higher kill risk raises priority — resolve fast, fail fast", () => {
    const safe = computeDecisionPriority({ ...BASE, killRiskScore: 0.1 });
    const risky = computeDecisionPriority({ ...BASE, killRiskScore: 0.9 });
    expect(risky).toBeGreaterThan(safe);
  });

  it("higher research cost lowers priority", () => {
    const cheap = computeDecisionPriority({ ...BASE, estimatedResearchCost: 0.1 });
    const expensive = computeDecisionPriority({ ...BASE, estimatedResearchCost: 0.9 });
    expect(cheap).toBeGreaterThan(expensive);
  });

  it("can go negative for a low-scoring, high-risk, expensive opportunity — never floored to 0", () => {
    const worstCase = computeDecisionPriority({
      opportunityScore: 0,
      confidenceScore: 1,
      killRiskScore: 0,
      topEvidenceGapImpactScore: 0,
      maxClaimEIG: 0,
      estimatedResearchCost: 1,
      timeSensitivityScore: 0,
      strategicFitScore: 0,
    });
    expect(worstCase).toBeLessThan(0);
  });
});

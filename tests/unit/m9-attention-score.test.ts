import { describe, expect, it } from "vitest";
import {
  ATTENTION_SCORE_WEIGHTS,
  computeFounderAttentionScore,
  DEFAULT_REVERSIBILITY,
  reversibilityFor,
  type FounderAttentionFactors,
} from "../../src/domain/attention/attention-score.js";

const ALL_ZERO: FounderAttentionFactors = {
  financialImpact: 0,
  urgency: 0,
  risk: 0,
  uncertainty: 0,
  reversibility: 0,
  opportunityCost: 0,
  evidenceQuality: 0,
  strategicImportance: 0,
  deadlineProximity: 0,
};
const ALL_ONE: FounderAttentionFactors = Object.fromEntries(Object.keys(ALL_ZERO).map((k) => [k, 1])) as unknown as FounderAttentionFactors;

describe("computeFounderAttentionScore — the nine-factor weighted sum (docs/M9_ARCHITECTURE_PROPOSAL.md §18)", () => {
  it("the nine weights sum to exactly 1.0 — never a magic composite that under- or over-weights the total", () => {
    const total = Object.values(ATTENTION_SCORE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("all factors at the floor (0) score 0; all factors at the ceiling (1) score 1", () => {
    expect(computeFounderAttentionScore(ALL_ZERO)).toBeCloseTo(0, 10);
    expect(computeFounderAttentionScore(ALL_ONE)).toBeCloseTo(1, 10);
  });

  it("weights the most financially-impactful, urgent factors more heavily than deadlineProximity alone", () => {
    const highFinancial = computeFounderAttentionScore({ ...ALL_ZERO, financialImpact: 1 });
    const highDeadline = computeFounderAttentionScore({ ...ALL_ZERO, deadlineProximity: 1 });
    expect(highFinancial).toBeGreaterThan(highDeadline);
  });

  it("throws rather than silently clamping an out-of-range or NaN factor — a caller bug should surface immediately, not produce a wrong score", () => {
    expect(() => computeFounderAttentionScore({ ...ALL_ZERO, risk: 1.5 })).toThrow();
    expect(() => computeFounderAttentionScore({ ...ALL_ZERO, risk: -0.1 })).toThrow();
    expect(() => computeFounderAttentionScore({ ...ALL_ZERO, risk: Number.NaN })).toThrow();
  });
});

describe("reversibilityFor — per-resource-type lookup (§18)", () => {
  it("returns the documented value for every known DecisionQueueEntry source", () => {
    expect(reversibilityFor("GROWTH_EXPERIMENT")).toBe(1);
    expect(reversibilityFor("BILLING_PLAN")).toBe(0.25);
    expect(reversibilityFor("COMPANY_RECOMMENDATION")).toBe(0.5);
  });

  it("falls back to DEFAULT_REVERSIBILITY for an unknown or unmapped source, never throwing", () => {
    expect(reversibilityFor("SOME_FUTURE_RESOURCE_TYPE")).toBe(DEFAULT_REVERSIBILITY);
  });
});

import { describe, expect, it } from "vitest";
import { recalculateClaimConfidence } from "../../src/domain/claim/confidence-formula.js";

const BASE = {
  priorConfidence: 0.3,
  reliability: 0.8,
  specificity: 0.8,
  recency: 1.0,
  independenceLevel: "KNOWN" as const,
  supportingCount: 3,
  contradictingCount: 0,
};

describe("recalculateClaimConfidence", () => {
  it("never moves confidence for UNVERIFIED — no evidence, no update", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "UNVERIFIED" });
    expect(result).toBe(BASE.priorConfidence);
  });

  it("never moves confidence for INSUFFICIENT_EVIDENCE — an honest 'found nothing' pass", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "INSUFFICIENT_EVIDENCE" });
    expect(result).toBe(BASE.priorConfidence);
  });

  it("SUPPORTED with strong evidence produces high confidence", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "SUPPORTED" });
    expect(result).toBeGreaterThan(0.7);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("CONTRADICTED produces low confidence", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "CONTRADICTED", supportingCount: 0 });
    expect(result).toBeLessThan(0.2);
  });

  it("CONFLICTED lands in the middle, never rounded to a false extreme", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "CONFLICTED" });
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBeLessThan(0.8);
  });

  it("a contradiction always lowers confidence, even alongside SUPPORTED status", () => {
    const withoutContradiction = recalculateClaimConfidence({ ...BASE, status: "SUPPORTED", contradictingCount: 0 });
    const withContradiction = recalculateClaimConfidence({ ...BASE, status: "SUPPORTED", contradictingCount: 2 });
    expect(withContradiction).toBeLessThan(withoutContradiction);
  });

  it("weak evidence (low reliability/specificity/recency, UNKNOWN independence, no corroboration) stays below the strong-evidence case even when both are SUPPORTED", () => {
    const strong = recalculateClaimConfidence({ ...BASE, status: "SUPPORTED" });
    const weak = recalculateClaimConfidence({
      status: "SUPPORTED",
      priorConfidence: 0.3,
      reliability: 0.2,
      specificity: 0.1,
      recency: 0.3,
      independenceLevel: "UNKNOWN",
      supportingCount: 1,
      contradictingCount: 0,
    });
    expect(weak).toBeLessThan(strong);
  });

  it("is always clamped to [0, 1]", () => {
    const result = recalculateClaimConfidence({ ...BASE, status: "SUPPORTED", reliability: 1, specificity: 1, recency: 1, supportingCount: 100 });
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

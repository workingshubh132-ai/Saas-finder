import { describe, expect, it } from "vitest";
import { computeSignalQualityScore } from "../../src/domain/signal/signal-quality.js";

describe("computeSignalQualityScore", () => {
  it("scores a HIGH-reliability, specific, recent signal higher than a LOW-reliability, thin, old one", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const strong = computeSignalQualityScore(
      { content: "A".repeat(300), reliability: "HIGH", publishedAt: new Date("2026-08-25T00:00:00Z") },
      now,
    );
    const weak = computeSignalQualityScore({ content: "short", reliability: "LOW", publishedAt: new Date("2020-01-01T00:00:00Z") }, now);
    expect(strong).toBeGreaterThan(weak);
  });

  it("stays within [0, 1]", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const score = computeSignalQualityScore({ content: "A".repeat(1000), reliability: "HIGH", publishedAt: now }, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("treats an unknown publish date as neutral, not penalized", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const withDate = computeSignalQualityScore({ content: "some content here", reliability: "MEDIUM", publishedAt: new Date("2026-08-01T00:00:00Z") }, now);
    const withoutDate = computeSignalQualityScore({ content: "some content here", reliability: "MEDIUM", publishedAt: null }, now);
    // Unknown recency (0.5) sits between "fresh" (1) and "very old" (0.2).
    expect(withoutDate).toBeLessThan(withDate);
    expect(withoutDate).toBeGreaterThan(0);
  });

  it("holding specificity and recency equal, reliability alone raises the score", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const highReliability = computeSignalQualityScore({ content: "A".repeat(300), reliability: "HIGH", publishedAt: now }, now);
    const lowReliability = computeSignalQualityScore({ content: "A".repeat(300), reliability: "LOW", publishedAt: now }, now);
    expect(highReliability).toBeGreaterThan(lowReliability);
  });
});

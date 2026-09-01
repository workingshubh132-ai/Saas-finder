import { describe, expect, it } from "vitest";
import { computeClusterConfidence } from "../../src/domain/signal/cluster-confidence.js";

describe("computeClusterConfidence", () => {
  it("returns 0 for an empty cluster", () => {
    expect(computeClusterConfidence([], 0)).toBe(0);
  });

  it("a cluster with 3+ independent sources scores higher than one with only 1, at equal quality (Part 13)", () => {
    const oneSource = computeClusterConfidence([0.7, 0.7, 0.7, 0.7, 0.7], 1); // 5 signals, all the same thread
    const threeSources = computeClusterConfidence([0.7, 0.7, 0.7], 3); // fewer signals, but independent
    expect(threeSources).toBeGreaterThan(oneSource);
  });

  it("stays within [0, 1]", () => {
    const confidence = computeClusterConfidence([1, 1, 1, 1, 1], 10);
    expect(confidence).toBeLessThanOrEqual(1);
    expect(confidence).toBeGreaterThanOrEqual(0);
  });

  it("higher average signal quality raises confidence at equal independence", () => {
    const lowQuality = computeClusterConfidence([0.2, 0.2], 2);
    const highQuality = computeClusterConfidence([0.9, 0.9], 2);
    expect(highQuality).toBeGreaterThan(lowQuality);
  });
});

import { describe, expect, it } from "vitest";
import { summarizeCalibration } from "../../src/domain/decision/calibration.js";

describe("summarizeCalibration", () => {
  it("flags insufficient sample size below the threshold", () => {
    const result = summarizeCalibration([{ confidenceAtDecision: 0.5, humanDecision: "APPROVED" }]);
    expect(result.insufficientSampleSize).toBe(true);
    expect(result.totalDecisions).toBe(1);
  });

  it("buckets by confidence range and computes approval rate per bucket", () => {
    const result = summarizeCalibration([
      { confidenceAtDecision: 0.85, humanDecision: "APPROVED" },
      { confidenceAtDecision: 0.9, humanDecision: "APPROVED" },
      { confidenceAtDecision: 0.1, humanDecision: "REJECTED" },
    ]);
    const highBucket = result.buckets.find((b) => b.range === "0.8-1.0")!;
    expect(highBucket.count).toBe(2);
    expect(highBucket.approvedRate).toBe(1);

    const lowBucket = result.buckets.find((b) => b.range === "0.0-0.2")!;
    expect(lowBucket.count).toBe(1);
    expect(lowBucket.approvedRate).toBe(0);
  });

  it("never fabricates an approval rate for an empty bucket", () => {
    const result = summarizeCalibration([{ confidenceAtDecision: 0.9, humanDecision: "APPROVED" }]);
    const emptyBucket = result.buckets.find((b) => b.range === "0.0-0.2")!;
    expect(emptyBucket.count).toBe(0);
    expect(emptyBucket.approvedRate).toBeNull();
  });

  it("excludes records with no confidence recorded from every bucket, but still counts them in totalDecisions", () => {
    const result = summarizeCalibration([{ confidenceAtDecision: null, humanDecision: "APPROVED" }]);
    expect(result.totalDecisions).toBe(1);
    expect(result.buckets.every((b) => b.count === 0)).toBe(true);
  });
});

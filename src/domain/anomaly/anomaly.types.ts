/**
 * Deterministic anomaly detection (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §19) — a rolling-baseline-and-threshold approach, no model call.
 * Covers revenue drops, conversion drops, traffic spikes, error
 * spikes, churn spikes, cost spikes, usage changes — all through this
 * one detector, parameterized by metric type, not seven bespoke ones.
 */
export const ANOMALY_DIRECTIONS = ["SPIKE", "DROP"] as const;
export type AnomalyDirection = (typeof ANOMALY_DIRECTIONS)[number];

export function isAnomalyDirection(value: string): value is AnomalyDirection {
  return (ANOMALY_DIRECTIONS as readonly string[]).includes(value);
}

/** Below this many trailing periods, "insufficient history" is the honest answer — no anomaly is ever declared. */
export const MIN_BASELINE_PERIODS = 3;

/** Founder-revisable, documented — same pattern as HIGH_RISK_THRESHOLD in kill-risk-scorer.ts. */
export const ANOMALY_Z_THRESHOLD = 2.0;

export interface AnomalyDetectionInput {
  /** Trailing baseline periods, oldest to newest — must NOT include the latest value being tested. */
  readonly trailingValues: readonly number[];
  readonly latestValue: number;
}

export interface AnomalyDetectionResult {
  readonly isAnomaly: boolean;
  readonly direction: AnomalyDirection | null;
  readonly zScore: number | null;
  readonly baselineMean: number | null;
  readonly baselineStdDev: number | null;
  readonly reason: string;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: readonly number[], meanValue: number): number {
  const variance = values.reduce((sum, v) => sum + (v - meanValue) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function detectAnomaly(input: AnomalyDetectionInput): AnomalyDetectionResult {
  if (input.trailingValues.length < MIN_BASELINE_PERIODS) {
    return {
      isAnomaly: false,
      direction: null,
      zScore: null,
      baselineMean: null,
      baselineStdDev: null,
      reason: `Only ${input.trailingValues.length} baseline period(s) observed — need at least ${MIN_BASELINE_PERIODS} before anomaly detection is meaningful.`,
    };
  }

  const baselineMean = mean(input.trailingValues);
  const baselineStdDev = stdDev(input.trailingValues, baselineMean);

  if (baselineStdDev === 0) {
    const isAnomaly = input.latestValue !== baselineMean;
    return {
      isAnomaly,
      direction: isAnomaly ? (input.latestValue > baselineMean ? "SPIKE" : "DROP") : null,
      zScore: null,
      baselineMean,
      baselineStdDev,
      reason: isAnomaly
        ? `Baseline was constant at ${baselineMean} with zero variance; latest value ${input.latestValue} differs.`
        : "Latest value matches a zero-variance baseline.",
    };
  }

  const zScore = (input.latestValue - baselineMean) / baselineStdDev;
  const isAnomaly = Math.abs(zScore) >= ANOMALY_Z_THRESHOLD;

  return {
    isAnomaly,
    direction: isAnomaly ? (zScore > 0 ? "SPIKE" : "DROP") : null,
    zScore,
    baselineMean,
    baselineStdDev,
    reason: isAnomaly
      ? `Latest value ${input.latestValue} is ${zScore.toFixed(2)} standard deviations from the trailing baseline mean ${baselineMean.toFixed(2)}.`
      : `Within normal range (z=${zScore.toFixed(2)}).`,
  };
}

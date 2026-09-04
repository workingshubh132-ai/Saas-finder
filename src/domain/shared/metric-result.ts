/**
 * The shared "never fabricate a number" return shape
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §18) — every deterministic metric
 * calculator that can legitimately fail to have a real answer (unit
 * economics, retention on a too-small cohort, churn with a zero
 * denominator) returns this instead of a sentinel number (`-1`, `0`)
 * a caller could accidentally treat as real. `UNKNOWN` means the
 * required input simply isn't tracked (e.g. no acquisition-cost
 * data exists at all); `INSUFFICIENT_DATA` means the input exists but
 * the sample is too small or the time window hasn't elapsed yet to
 * trust a computed value from it.
 */
export type MetricResult =
  | { readonly status: "COMPUTED"; readonly value: number }
  | { readonly status: "UNKNOWN" }
  | { readonly status: "INSUFFICIENT_DATA"; readonly reason: string };

export function computed(value: number): MetricResult {
  return { status: "COMPUTED", value };
}

export const UNKNOWN: MetricResult = { status: "UNKNOWN" };

export function insufficientData(reason: string): MetricResult {
  return { status: "INSUFFICIENT_DATA", reason };
}

export function isComputed(result: MetricResult): result is { status: "COMPUTED"; value: number } {
  return result.status === "COMPUTED";
}

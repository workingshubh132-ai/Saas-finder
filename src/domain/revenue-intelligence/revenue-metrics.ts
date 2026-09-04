import { type MetricResult, computed, insufficientData } from "../shared/metric-result.js";

/**
 * MRR/ARR/ARPU/expansion/contraction (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §16). Deterministic sums over already-observed subscription data —
 * no model call. Which BusinessMetricValueKind each result becomes
 * (OBSERVED for a direct sum, INFERRED for a ratio like ARPU) is
 * decided by the caller that persists these as BusinessMetric rows
 * (assertMetricProvenance), not by this pure computation.
 */
export interface ActiveSubscriptionSnapshot {
  readonly id: string;
  readonly monthlyValueUsd: number;
}

export interface RevenueMetricsInput {
  readonly activeSubscriptions: readonly ActiveSubscriptionSnapshot[];
  readonly newMrr: number;
  readonly expansionMrr: number;
  readonly contractionMrr: number;
  readonly churnedMrr: number;
  readonly refundsUsd: number;
}

export interface RevenueMetricsResult {
  readonly mrr: MetricResult;
  readonly arr: MetricResult;
  readonly arpu: MetricResult;
  readonly newMrr: MetricResult;
  readonly expansionMrr: MetricResult;
  readonly contractionMrr: MetricResult;
  readonly churnedMrr: MetricResult;
  readonly refundsUsd: MetricResult;
}

export function computeRevenueMetrics(input: RevenueMetricsInput): RevenueMetricsResult {
  const mrrValue = input.activeSubscriptions.reduce((sum, s) => sum + s.monthlyValueUsd, 0);

  return {
    mrr: computed(mrrValue),
    arr: computed(mrrValue * 12),
    arpu:
      input.activeSubscriptions.length > 0
        ? computed(mrrValue / input.activeSubscriptions.length)
        : insufficientData("No active subscriptions — ARPU is undefined."),
    newMrr: computed(input.newMrr),
    expansionMrr: computed(input.expansionMrr),
    contractionMrr: computed(input.contractionMrr),
    churnedMrr: computed(input.churnedMrr),
    refundsUsd: computed(input.refundsUsd),
  };
}

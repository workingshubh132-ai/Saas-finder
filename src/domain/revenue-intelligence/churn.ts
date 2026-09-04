import { type MetricResult, computed, insufficientData } from "../shared/metric-result.js";

/**
 * Four separately computed, separately stored churn metrics
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §7 — "do not confuse them"): logo
 * churn, revenue churn, gross revenue retention, net revenue
 * retention. Each is its own function and its own BusinessMetricType
 * (LOGO_CHURN_RATE/REVENUE_CHURN_RATE/GROSS_REVENUE_RETENTION/
 * NET_REVENUE_RETENTION) rather than one generic rate reused four ways.
 */
export const MIN_CHURN_SAMPLE = 3;

export interface SubscriptionPeriodDelta {
  readonly startingActiveCount: number;
  readonly startingMrr: number;
  readonly cancelledCount: number;
  readonly churnedMrr: number;
  /** Downgrades within accounts that stayed subscribed. */
  readonly contractedMrr: number;
  /** Upgrades within accounts that stayed subscribed. */
  readonly expansionMrr: number;
}

export function computeLogoChurn(delta: SubscriptionPeriodDelta): MetricResult {
  if (delta.startingActiveCount < MIN_CHURN_SAMPLE) {
    return insufficientData(`Only ${delta.startingActiveCount} active subscription(s) at period start — need at least ${MIN_CHURN_SAMPLE}.`);
  }
  return computed(delta.cancelledCount / delta.startingActiveCount);
}

export function computeRevenueChurn(delta: SubscriptionPeriodDelta): MetricResult {
  if (delta.startingMrr <= 0) {
    return insufficientData("Starting MRR is zero — revenue churn is undefined.");
  }
  return computed(delta.churnedMrr / delta.startingMrr);
}

export function computeGrossRevenueRetention(delta: SubscriptionPeriodDelta): MetricResult {
  if (delta.startingMrr <= 0) {
    return insufficientData("Starting MRR is zero — gross revenue retention is undefined.");
  }
  return computed((delta.startingMrr - delta.churnedMrr - delta.contractedMrr) / delta.startingMrr);
}

export function computeNetRevenueRetention(delta: SubscriptionPeriodDelta): MetricResult {
  if (delta.startingMrr <= 0) {
    return insufficientData("Starting MRR is zero — net revenue retention is undefined.");
  }
  return computed((delta.startingMrr - delta.churnedMrr - delta.contractedMrr + delta.expansionMrr) / delta.startingMrr);
}

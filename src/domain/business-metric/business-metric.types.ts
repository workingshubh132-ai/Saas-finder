/**
 * The structural "observed vs. estimated" enforcement Section 45 of
 * the M7 brief demands (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §23):
 * valueKind is a real column, never a prose label, and every read path
 * must group or label by it — an aggregate that silently blends
 * OBSERVED and ESTIMATED numbers is exactly the "fake business" failure
 * mode this exists to prevent.
 */
export const BUSINESS_METRIC_TYPES = [
  "REVENUE_USD",
  "ACTIVE_SUBSCRIPTIONS",
  "UPTIME_PCT",
  "CONVERSION_RATE",
  "MONTHLY_OPERATING_COST_USD",
  "CHURN_RATE",
] as const;
export type BusinessMetricType = (typeof BUSINESS_METRIC_TYPES)[number];

export function isBusinessMetricType(value: string): value is BusinessMetricType {
  return (BUSINESS_METRIC_TYPES as readonly string[]).includes(value);
}

export const BUSINESS_METRIC_VALUE_KINDS = ["OBSERVED", "ESTIMATED"] as const;
export type BusinessMetricValueKind = (typeof BUSINESS_METRIC_VALUE_KINDS)[number];

export function isBusinessMetricValueKind(value: string): value is BusinessMetricValueKind {
  return (BUSINESS_METRIC_VALUE_KINDS as readonly string[]).includes(value);
}

/** Where a metric's value actually came from — never optional, never inferred after the fact. */
export const BUSINESS_METRIC_SOURCES = ["DEV_FIXTURE", "MANUAL_ENTRY", "COMPUTED_ESTIMATE"] as const;
export type BusinessMetricSource = (typeof BUSINESS_METRIC_SOURCES)[number];

export function isBusinessMetricSource(value: string): value is BusinessMetricSource {
  return (BUSINESS_METRIC_SOURCES as readonly string[]).includes(value);
}

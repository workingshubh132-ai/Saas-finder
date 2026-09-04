/**
 * Data freshness and quality checks (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §32) — deterministic, no model call. Freshness makes stale data
 * visible rather than treating it as current truth (M8 brief §31);
 * quality checks turn a bad value into a real, surfaced issue rather
 * than a silently wrong number.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStale(recordedAt: Date, now: Date, staleAfterMs: number = STALE_AFTER_MS): boolean {
  return now.getTime() - recordedAt.getTime() > staleAfterMs;
}

export const DATA_QUALITY_ISSUE_TYPES = ["MISSING_EVENT", "DUPLICATE_EVENT", "IMPOSSIBLE_VALUE", "TIMESTAMP_ANOMALY", "SOURCE_INCONSISTENCY", "PARTIAL_INGESTION"] as const;
export type DataQualityIssueType = (typeof DATA_QUALITY_ISSUE_TYPES)[number];

export interface DataQualityIssue {
  readonly type: DataQualityIssueType;
  readonly detail: string;
}

/** A metric type that can never legitimately be negative — a negative value here is impossible, not merely surprising. */
const NEVER_NEGATIVE_METRIC_TYPES = new Set([
  "REVENUE_USD",
  "ACTIVE_SUBSCRIPTIONS",
  "MRR",
  "ARR",
  "ARPU",
  "MONTHLY_OPERATING_COST_USD",
  "CAC",
  "LTV",
]);

/** A rate/percentage metric type that must fall within [0, 1] — outside that range is an impossible value, not an extreme one. */
const UNIT_INTERVAL_METRIC_TYPES = new Set([
  "UPTIME_PCT",
  "CONVERSION_RATE",
  "CHURN_RATE",
  "ACTIVATION_RATE",
  "RETENTION_D1",
  "RETENTION_D7",
  "RETENTION_D14",
  "RETENTION_D30",
  "LOGO_CHURN_RATE",
  "REVENUE_CHURN_RATE",
]);

export function checkMetricValueQuality(metricType: string, value: number): DataQualityIssue | null {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return { type: "IMPOSSIBLE_VALUE", detail: `${metricType} value is not a finite number (${String(value)}).` };
  }
  if (NEVER_NEGATIVE_METRIC_TYPES.has(metricType) && value < 0) {
    return { type: "IMPOSSIBLE_VALUE", detail: `${metricType} is negative (${value}) — this metric can never legitimately be negative.` };
  }
  if (UNIT_INTERVAL_METRIC_TYPES.has(metricType) && (value < 0 || value > 1)) {
    return { type: "IMPOSSIBLE_VALUE", detail: `${metricType} of ${value} is outside the valid [0, 1] range for a rate.` };
  }
  return null;
}

/** Duplicate detection for a batch of same-typed events sharing an idempotency-relevant key (e.g. a provider's own event id). */
export function findDuplicateKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

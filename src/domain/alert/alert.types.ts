/**
 * Company Alerts (docs/M9_ARCHITECTURE_PROPOSAL.md §35, M9 brief §23)
 * — every source below is a REAL, already-existing event or computed
 * condition in this codebase (an Anomaly row, an Incident, a
 * BusinessHealth state transition, a provider failure, a budget
 * ceiling) — never a new detector. Ranked by the SAME
 * computeFounderAttentionScore formula an alert is just another kind
 * of attention item (docs/M9_ARCHITECTURE_PROPOSAL.md §35's own "no
 * second ranking system").
 */
export const ALERT_TYPES = [
  "ANOMALY",
  "BUSINESS_HEALTH_DECLINED",
  "INCIDENT",
  "PROVIDER_FAILURE",
  "BUDGET_EXHAUSTED",
  "CUSTOMER_LOST",
  "RAPID_GROWTH",
  "UNEXPECTED_OPPORTUNITY",
  "CONTRADICTORY_EVIDENCE",
  "STALE_APPROVAL",
  "CONCURRENT_CONFLICT",
  "EMERGENCY_STOP",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(value);
}

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export function isAlertSeverity(value: string): value is AlertSeverity {
  return (ALERT_SEVERITIES as readonly string[]).includes(value);
}

/**
 * "Avoid alert spam" (M9 brief §23's own words) — two alerts for the
 * same (alertType, resourceType, resourceId) within this rolling
 * window collapse into one, with occurrenceCount incremented rather
 * than a new row created.
 */
export const ALERT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AlertDedupKey {
  readonly alertType: AlertType;
  readonly resourceType: string;
  readonly resourceId: string;
}

export function sameDedupKey(a: AlertDedupKey, b: AlertDedupKey): boolean {
  return a.alertType === b.alertType && a.resourceType === b.resourceType && a.resourceId === b.resourceId;
}

export function withinDedupWindow(existingCreatedAt: Date, now: Date): boolean {
  return now.getTime() - existingCreatedAt.getTime() < ALERT_DEDUP_WINDOW_MS;
}

/**
 * Seam for recording and reading back a product usage/business event
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §11, §23; widened for M8's read
 * side, docs/M8_ARCHITECTURE_PROPOSAL.md §31). `track` is unchanged
 * from M7 — every existing call site keeps working. `query` is new:
 * bounded, paginated, time-windowed at the type level (a caller cannot
 * even construct an unbounded request), the concrete enforcement of
 * §34's "no SELECT EVERYTHING."
 */
export interface AnalyticsTrackInput {
  readonly name: string;
  readonly productId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** Opaque per-user identifier — never raw PII. Optional for M7 backward compatibility; required in practice for any M8 retention/cohort read. */
  readonly userRef?: string;
  /** Defaults to the moment `track` is called. */
  readonly occurredAt?: Date;
}

export interface AnalyticsTrackResult {
  readonly recorded: boolean;
}

export const MAX_ANALYTICS_QUERY_LIMIT = 2000;
export const DEFAULT_ANALYTICS_QUERY_LIMIT = 500;

export interface AnalyticsQueryInput {
  readonly productId: string;
  readonly eventName?: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** Capped at MAX_ANALYTICS_QUERY_LIMIT — enforced by every implementation, not just documented. */
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AnalyticsTrackedEvent {
  readonly name: string;
  readonly productId: string;
  readonly userRef: string | null;
  readonly occurredAt: Date;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface AnalyticsQueryResult {
  readonly events: readonly AnalyticsTrackedEvent[];
  readonly nextCursor: string | null;
}

export interface AnalyticsProvider {
  readonly id: string;
  track(event: AnalyticsTrackInput): Promise<AnalyticsTrackResult>;
  query(input: AnalyticsQueryInput): Promise<AnalyticsQueryResult>;
}

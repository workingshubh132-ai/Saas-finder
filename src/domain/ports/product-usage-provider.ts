/**
 * Seam for product-intelligence's usage-event reads
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §4-5, §31). Deliberately thin —
 * DevProductUsageProvider wraps the same AnalyticsProvider event store
 * `track()` already writes to (§31: "not a second, disconnected
 * fixture universe"), translating to this narrower, usage-analysis-
 * specific shape rather than exposing AnalyticsProvider's own general
 * query surface directly to product-intelligence code.
 */
export interface ProductUsageEvent {
  readonly name: string;
  readonly userRef: string;
  readonly occurredAt: Date;
}

export interface ListUsageEventsQuery {
  readonly productId: string;
  readonly eventName?: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly limit?: number;
}

export interface ProductUsageProvider {
  readonly id: string;
  listEvents(query: ListUsageEventsQuery): Promise<readonly ProductUsageEvent[]>;
}

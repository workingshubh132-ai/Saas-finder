import type { AnalyticsProvider } from "../domain/ports/analytics-provider.js";
import { MAX_ANALYTICS_QUERY_LIMIT } from "../domain/ports/analytics-provider.js";
import type { ListUsageEventsQuery, ProductUsageEvent, ProductUsageProvider } from "../domain/ports/product-usage-provider.js";

/**
 * Wraps an AnalyticsProvider's own event store rather than holding a
 * second, disconnected fixture (docs/M8_ARCHITECTURE_PROPOSAL.md §31)
 * — a usage event IS an analytics event; this only narrows the shape
 * product-intelligence code actually needs.
 */
export class DevProductUsageProvider implements ProductUsageProvider {
  readonly id = "DEV_FIXTURE";

  constructor(private readonly analytics: AnalyticsProvider) {}

  async listEvents(query: ListUsageEventsQuery): Promise<readonly ProductUsageEvent[]> {
    const events: ProductUsageEvent[] = [];
    let cursor: string | null | undefined;

    do {
      const page = await this.analytics.query({
        productId: query.productId,
        eventName: query.eventName,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        limit: Math.min(query.limit ?? MAX_ANALYTICS_QUERY_LIMIT, MAX_ANALYTICS_QUERY_LIMIT),
        cursor: cursor ?? undefined,
      });
      for (const e of page.events) {
        if (e.userRef) events.push({ name: e.name, userRef: e.userRef, occurredAt: e.occurredAt });
      }
      cursor = page.nextCursor;
    } while (cursor && events.length < (query.limit ?? MAX_ANALYTICS_QUERY_LIMIT));

    return events;
  }
}

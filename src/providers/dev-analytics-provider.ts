import type {
  AnalyticsProvider,
  AnalyticsQueryInput,
  AnalyticsQueryResult,
  AnalyticsTrackedEvent,
  AnalyticsTrackInput,
  AnalyticsTrackResult,
} from "../domain/ports/analytics-provider.js";
import { MAX_ANALYTICS_QUERY_LIMIT, DEFAULT_ANALYTICS_QUERY_LIMIT } from "../domain/ports/analytics-provider.js";

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §11, §23) —
 * in-memory. `listTracked` is a test/demo-only accessor, never called
 * from any production-shaped code path. `query` (M8,
 * docs/M8_ARCHITECTURE_PROPOSAL.md §31) is bounded and time-windowed —
 * every call clamps `limit` to MAX_ANALYTICS_QUERY_LIMIT regardless of
 * what's requested.
 */
export class DevAnalyticsProvider implements AnalyticsProvider {
  readonly id = "DEV_FIXTURE";
  private readonly events: AnalyticsTrackedEvent[] = [];

  async track(event: AnalyticsTrackInput): Promise<AnalyticsTrackResult> {
    this.events.push({
      name: event.name,
      productId: event.productId,
      userRef: event.userRef ?? null,
      occurredAt: event.occurredAt ?? new Date(),
      properties: event.properties,
    });
    return { recorded: true };
  }

  async query(input: AnalyticsQueryInput): Promise<AnalyticsQueryResult> {
    const limit = Math.min(input.limit ?? DEFAULT_ANALYTICS_QUERY_LIMIT, MAX_ANALYTICS_QUERY_LIMIT);
    const matching = this.events
      .filter((e) => e.productId === input.productId)
      .filter((e) => (input.eventName ? e.name === input.eventName : true))
      .filter((e) => e.occurredAt >= input.periodStart && e.occurredAt <= input.periodEnd)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const startIndex = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const page = matching.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + page.length;

    return {
      events: page,
      nextCursor: nextIndex < matching.length ? String(nextIndex) : null,
    };
  }

  listTracked(): readonly AnalyticsTrackedEvent[] {
    return this.events;
  }
}

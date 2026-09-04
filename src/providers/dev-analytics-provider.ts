import type { AnalyticsProvider, AnalyticsTrackInput, AnalyticsTrackResult } from "../domain/ports/analytics-provider.js";

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §11, §23) —
 * in-memory. `listTracked` is a test/demo-only accessor, never called
 * from any production-shaped code path.
 */
export class DevAnalyticsProvider implements AnalyticsProvider {
  readonly id = "DEV_FIXTURE";
  private readonly events: AnalyticsTrackInput[] = [];

  async track(event: AnalyticsTrackInput): Promise<AnalyticsTrackResult> {
    this.events.push(event);
    return { recorded: true };
  }

  listTracked(): readonly AnalyticsTrackInput[] {
    return this.events;
  }
}

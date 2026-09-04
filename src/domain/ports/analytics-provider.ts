/**
 * Seam for recording a product usage/business event
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §11, §23). Only DevAnalyticsProvider
 * exists in M7, called only from the demo/test flow — never from
 * generated-product code, never automatically.
 */
export interface AnalyticsTrackInput {
  readonly name: string;
  readonly productId: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface AnalyticsTrackResult {
  readonly recorded: boolean;
}

export interface AnalyticsProvider {
  readonly id: string;
  track(event: AnalyticsTrackInput): Promise<AnalyticsTrackResult>;
}

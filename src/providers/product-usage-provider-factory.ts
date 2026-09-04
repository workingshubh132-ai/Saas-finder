import type { ProductUsageProvider } from "../domain/ports/product-usage-provider.js";
import { DevProductUsageProvider } from "./dev-product-usage-provider.js";
import { createAnalyticsProvider } from "./analytics-provider-factory.js";

/** Wraps the same AnalyticsProvider singleton (docs/M8_ARCHITECTURE_PROPOSAL.md §31) — not a second event store. */
const instance = new DevProductUsageProvider(createAnalyticsProvider());

export function createProductUsageProvider(): ProductUsageProvider {
  return instance;
}

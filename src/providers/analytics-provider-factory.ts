import type { AnalyticsProvider } from "../domain/ports/analytics-provider.js";
import { DevAnalyticsProvider } from "./dev-analytics-provider.js";

/** Mirrors deployment-provider-factory.ts. Only DevAnalyticsProvider exists in M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §11). */
const instance = new DevAnalyticsProvider();

export function createAnalyticsProvider(): AnalyticsProvider {
  return instance;
}

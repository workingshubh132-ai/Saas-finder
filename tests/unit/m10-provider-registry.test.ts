import { describe, expect, it } from "vitest";
import { createBillingProvider } from "../../src/providers/billing-provider-factory.js";
import { createDeploymentProvider } from "../../src/providers/deployment-provider-factory.js";
import { createMonitoringProvider } from "../../src/providers/monitoring-provider-factory.js";
import { createAnalyticsProvider } from "../../src/providers/analytics-provider-factory.js";
import { createSecretProvider } from "../../src/providers/secret-provider-factory.js";
import { createRevenueProvider } from "../../src/providers/revenue-provider-factory.js";
import { createProductUsageProvider } from "../../src/providers/product-usage-provider-factory.js";
import { createCustomerDataProvider } from "../../src/providers/customer-data-provider-factory.js";

/**
 * Regression guard for docs/M10_REAL_WORLD_AUDIT.md's central finding:
 * every non-model provider in this codebase is DEV_FIXTURE only, with
 * no live branch to accidentally enable. If any of these ever start
 * returning something other than "DEV_FIXTURE", that is a real
 * provider being wired in — a deliberate, reviewed change, never a
 * silent one — and this test should be updated deliberately alongside
 * it, not pass by accident.
 */
describe("provider registry stays DEV_FIXTURE-only (docs/M10_REAL_WORLD_AUDIT.md)", () => {
  it("every M7/M8 provider factory returns the DEV_FIXTURE singleton", () => {
    expect(createBillingProvider().id).toBe("DEV_FIXTURE");
    expect(createDeploymentProvider().id).toBe("DEV_FIXTURE");
    expect(createMonitoringProvider().id).toBe("DEV_FIXTURE");
    expect(createAnalyticsProvider().id).toBe("DEV_FIXTURE");
    expect(createSecretProvider().id).toBe("DEV_FIXTURE");
    expect(createRevenueProvider().id).toBe("DEV_FIXTURE");
    expect(createProductUsageProvider().id).toBe("DEV_FIXTURE");
    expect(createCustomerDataProvider().id).toBe("DEV_FIXTURE");
  });
});

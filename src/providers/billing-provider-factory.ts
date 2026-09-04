import type { BillingProvider } from "../domain/ports/billing-provider.js";
import { DevBillingProvider } from "./dev-billing-provider.js";

/**
 * Mirrors deployment-provider-factory.ts exactly — one module-level
 * singleton so a later createSubscription/status call sees what an
 * earlier createProduct/createPrice/createCustomer call created. Only
 * DevBillingProvider exists in M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §7, §9).
 */
const instance = new DevBillingProvider();

export function createBillingProvider(): BillingProvider {
  return instance;
}

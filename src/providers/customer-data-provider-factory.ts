import type { CustomerDataProvider } from "../domain/ports/customer-data-provider.js";
import { DevCustomerDataProvider } from "./dev-customer-data-provider.js";

/** Mirrors billing-provider-factory.ts. Only DevCustomerDataProvider exists in M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §31). */
const instance = new DevCustomerDataProvider();

export function createCustomerDataProvider(): CustomerDataProvider {
  return instance;
}

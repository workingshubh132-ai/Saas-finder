import type { RevenueProvider } from "../domain/ports/revenue-provider.js";
import { DevRevenueProvider } from "./dev-revenue-provider.js";

/** Mirrors billing-provider-factory.ts. Only DevRevenueProvider exists in M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §31). */
const instance = new DevRevenueProvider();

export function createRevenueProvider(): RevenueProvider {
  return instance;
}

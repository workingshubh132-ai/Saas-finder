import type { MonitoringProvider } from "../domain/ports/monitoring-provider.js";
import { DevMonitoringProvider } from "./dev-monitoring-provider.js";

/** Mirrors deployment-provider-factory.ts. Only DevMonitoringProvider exists in M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §12). */
const instance = new DevMonitoringProvider();

export function createMonitoringProvider(): MonitoringProvider {
  return instance;
}

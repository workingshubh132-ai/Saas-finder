import type { HealthCheckInput, HealthCheckResult, MonitoringProvider } from "../domain/ports/monitoring-provider.js";

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §12, §24) — a
 * deterministic function of its real input, never Math.random(): an
 * empty providerRef is unhealthy (nothing to check), everything else
 * reports healthy with a latency derived from the ref itself so
 * repeated tests are reproducible.
 */
export class DevMonitoringProvider implements MonitoringProvider {
  readonly id = "DEV_FIXTURE";

  async checkHealth(input: HealthCheckInput): Promise<HealthCheckResult> {
    if (!input.providerRef.trim()) {
      return { healthy: false, latencyMs: 0, detail: `[DEV_FIXTURE] Deployment ${input.deploymentId} has no providerRef — nothing to check.` };
    }
    const latencyMs = 40 + (input.providerRef.length % 20);
    return { healthy: true, latencyMs, detail: `[DEV_FIXTURE] Deployment ${input.deploymentId} (providerRef=${input.providerRef}) responded in ${latencyMs}ms.` };
  }
}

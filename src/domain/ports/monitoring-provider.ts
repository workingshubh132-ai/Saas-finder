/**
 * Seam for an on-demand deployment health check
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §12, §24) — called only on demand
 * (an API call or the demo script), never on a background schedule; no
 * scheduler infrastructure exists anywhere in this codebase.
 */
export interface HealthCheckInput {
  readonly deploymentId: string;
  readonly providerRef: string;
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

export interface MonitoringProvider {
  readonly id: string;
  checkHealth(input: HealthCheckInput): Promise<HealthCheckResult>;
}

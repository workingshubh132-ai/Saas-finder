import { deploymentRepository } from "../db/repositories/deployment.repository.js";
import type { HealthCheckResult } from "../domain/ports/monitoring-provider.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { createMonitoringProvider } from "../providers/monitoring-provider-factory.js";
import { auditService } from "./audit.service.js";

export interface CheckDeploymentHealthParams {
  deploymentId: string;
}

/**
 * On-demand only (docs/M7_ARCHITECTURE_PROPOSAL.md §12, §24) — called
 * by an API request or the demo script, never on a background
 * schedule; no scheduler infrastructure exists anywhere in this
 * codebase. A named, stated limitation, not a silent gap.
 */
export const monitoringService = {
  async checkHealth(params: CheckDeploymentHealthParams): Promise<HealthCheckResult> {
    const deployment = await deploymentRepository.findById(params.deploymentId);
    if (!deployment) throw new NotFoundError("Deployment", params.deploymentId);

    const provider = createMonitoringProvider();
    const result = await provider.checkHealth({ deploymentId: deployment.id, providerRef: deployment.providerRef });

    await auditService.record({
      actorType: "SYSTEM",
      actorId: null,
      action: "DEPLOYMENT_HEALTH_CHECK",
      resourceType: "DEPLOYMENT",
      resourceId: deployment.id,
      result: result.healthy ? "SUCCESS" : "FAILURE",
      metadata: { latencyMs: result.latencyMs, detail: result.detail, provider: provider.id },
    });

    return result;
  },
};

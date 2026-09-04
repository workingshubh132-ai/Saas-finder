import { randomUUID } from "node:crypto";
import type {
  DeployInput,
  DeployResult,
  DeploymentPlanInput,
  DeploymentPlanResult,
  DeploymentProvider,
  DeploymentStatusResult,
  DeploymentValidateInput,
  DeploymentValidateResult,
  RollbackInput,
  RollbackResult,
} from "../domain/ports/deployment-provider.js";

interface FixtureDeployment {
  environment: string;
  artifactRef: string;
  status: "LIVE" | "FAILED" | "ROLLED_BACK";
}

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §7-8) — in-memory,
 * zero network calls, can never reach anything real. deploy() fails
 * deterministically on a genuinely invalid input (matches every other
 * dev fixture in this codebase: derived from real input, never a
 * static stub or a random chance of failure).
 */
export class DevDeploymentProvider implements DeploymentProvider {
  readonly id = "DEV_FIXTURE";
  private readonly deployments = new Map<string, FixtureDeployment>();

  async validate(input: DeploymentValidateInput): Promise<DeploymentValidateResult> {
    if (!input.artifactRef.trim()) {
      return { valid: false, reason: "artifactRef is empty." };
    }
    return { valid: true };
  }

  async plan(input: DeploymentPlanInput): Promise<DeploymentPlanResult> {
    return {
      summary: `[DEV_FIXTURE] Deploy artifact "${input.artifactRef}" to ${input.environment}. No real infrastructure will be touched.`,
      estimatedDowntimeSeconds: 0,
    };
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const validation = await this.validate(input);
    if (!validation.valid) {
      return { status: "FAILED", providerRef: "", detail: `[DEV_FIXTURE] ${validation.reason ?? "Invalid input."}` };
    }
    const providerRef = `dev-deploy-${randomUUID()}`;
    this.deployments.set(providerRef, { environment: input.environment, artifactRef: input.artifactRef, status: "LIVE" });
    return { status: "LIVE", providerRef, detail: `[DEV_FIXTURE] Deployed "${input.artifactRef}" to ${input.environment}.` };
  }

  async status(providerRef: string): Promise<DeploymentStatusResult> {
    const record = this.deployments.get(providerRef);
    if (!record) return { status: "UNKNOWN" };
    return { status: record.status === "ROLLED_BACK" ? "FAILED" : record.status };
  }

  async rollback(input: RollbackInput): Promise<RollbackResult> {
    const record = this.deployments.get(input.providerRef);
    if (!record) {
      return { status: "FAILED", detail: `[DEV_FIXTURE] Unknown providerRef "${input.providerRef}".` };
    }
    record.status = "ROLLED_BACK";
    return { status: "ROLLED_BACK", detail: `[DEV_FIXTURE] Rolled back "${record.artifactRef}" in ${record.environment}.` };
  }
}

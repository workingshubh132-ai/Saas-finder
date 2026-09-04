/**
 * Seam for M7's deployment-EXECUTE step to call a real hosting target
 * without the kernel depending on a specific vendor
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §7-8) — mirrors ModelProvider's own
 * seam exactly. Only DevDeploymentProvider exists in M7; a real
 * implementation is additive later, never a change to this contract or
 * to any calling code.
 */
export interface DeploymentValidateInput {
  readonly environment: string;
  readonly artifactRef: string;
}

export interface DeploymentValidateResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export interface DeploymentPlanInput {
  readonly environment: string;
  readonly artifactRef: string;
}

export interface DeploymentPlanResult {
  readonly summary: string;
  readonly estimatedDowntimeSeconds: number;
}

export interface DeployInput {
  readonly environment: string;
  readonly artifactRef: string;
}

export interface DeployResult {
  readonly status: "LIVE" | "FAILED";
  readonly providerRef: string;
  readonly detail: string;
}

export interface DeploymentStatusResult {
  readonly status: "LIVE" | "FAILED" | "UNKNOWN";
}

export interface RollbackInput {
  readonly providerRef: string;
}

export interface RollbackResult {
  readonly status: "ROLLED_BACK" | "FAILED";
  readonly detail: string;
}

export interface DeploymentProvider {
  readonly id: string;
  validate(input: DeploymentValidateInput): Promise<DeploymentValidateResult>;
  plan(input: DeploymentPlanInput): Promise<DeploymentPlanResult>;
  deploy(input: DeployInput): Promise<DeployResult>;
  status(providerRef: string): Promise<DeploymentStatusResult>;
  rollback(input: RollbackInput): Promise<RollbackResult>;
}

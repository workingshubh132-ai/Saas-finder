/**
 * Deployment preparation (docs/M6_ARCHITECTURE_PROPOSAL.md §25) — a
 * PLAN only, compiled from this build's own real architecture
 * decisions. M6 never deploys autonomously: no code here calls any
 * hosting API, purchases any resource, or touches production
 * infrastructure — this function only assembles text a human reads
 * before deciding whether to act on it themselves.
 */
export interface DeploymentPlanInputs {
  productName: string;
  deploymentStrategy: string;
  healthCheck: string;
}

export function compileDeploymentPlan(inputs: DeploymentPlanInputs): string {
  return [
    `Deployment plan for ${inputs.productName} — a PLAN only (docs/M6_ARCHITECTURE_PROPOSAL.md §25); nothing here is executed automatically:`,
    "1. A human reviews this plan alongside the compiled ProductReviewMemo before taking any action.",
    "2. Provision real hosting and set real environment configuration — not done automatically by this system.",
    `3. Deploy strategy: ${inputs.deploymentStrategy}`,
    `4. Health check: ${inputs.healthCheck}`,
    "5. Smoke-test the deployed health check before directing any real traffic to it.",
  ].join("\n");
}

export function compileRollbackPlan(inputs: { productName: string }): string {
  return [
    `Rollback plan for ${inputs.productName}:`,
    "1. Keep the prior deployed version (or \"no prior deployment\") addressable until the new one is verified healthy.",
    "2. If the health check fails or a human flags a regression, redirect traffic back to the prior version, or take the new one offline if there was no prior version.",
    "3. This build's own workspace and generated code remain available for a fixed re-attempt — nothing is deleted by a rollback.",
  ].join("\n");
}

/**
 * One row per actual EXECUTE/rollback attempt against a DeploymentPlan
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §16-18) — created already in its
 * terminal status (mirrors ToolExecution's own SUCCESS/FAILED-at-creation
 * shape), never mutated afterward. A rollback is a NEW Deployment row
 * with rolledBackFromId set, never an edit to the row being rolled back.
 */
export const DEPLOYMENT_STATUSES = ["LIVE", "FAILED", "ROLLED_BACK"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export function isDeploymentStatus(value: string): value is DeploymentStatus {
  return (DEPLOYMENT_STATUSES as readonly string[]).includes(value);
}

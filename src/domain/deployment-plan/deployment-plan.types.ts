import type { TransitionTable } from "../shared/state-machine.js";

/** Where a DeploymentPlan targets (docs/M7_ARCHITECTURE_PROPOSAL.md §13) — a plain label; no real environment is ever provisioned. */
export const DEPLOYMENT_ENVIRONMENTS = ["DEV", "STAGING", "PRODUCTION"] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export function isDeploymentEnvironment(value: string): value is DeploymentEnvironment {
  return (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * DeploymentPlan lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16-17) —
 * immutable once created, mirroring OutreachMessage's own immutability
 * discipline: a revised plan is a new row with a fresh id, requiring
 * its own fresh approval. HUMAN_APPROVED never advances automatically
 * on a failed EXECUTE attempt (§39) — only a real, successful
 * Deployment moves it to EXECUTED; re-EXECUTE against the same
 * approved plan after a transient failure is expected and safe.
 */
export const DEPLOYMENT_PLAN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "HUMAN_APPROVED", "EXECUTED", "REJECTED"] as const;
export type DeploymentPlanStatus = (typeof DEPLOYMENT_PLAN_STATUSES)[number];

export function isDeploymentPlanStatus(value: string): value is DeploymentPlanStatus {
  return (DEPLOYMENT_PLAN_STATUSES as readonly string[]).includes(value);
}

export const DEPLOYMENT_PLAN_STATUS_TRANSITIONS: TransitionTable<DeploymentPlanStatus> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["HUMAN_APPROVED", "REJECTED"],
  HUMAN_APPROVED: ["EXECUTED"],
  EXECUTED: [],
  REJECTED: [],
};

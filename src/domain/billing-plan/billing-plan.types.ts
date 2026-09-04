import type { TransitionTable } from "../shared/state-machine.js";

/**
 * BillingPlan lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §19) —
 * "the minimum correct state machine": no READY state distinct from
 * DRAFT, since nothing about a billing plan needs a separate readiness
 * signal a human's own approval doesn't already carry. HUMAN_APPROVED
 * never advances automatically on a failed ACTIVATE_BILLING attempt,
 * same discipline as DeploymentPlan (§39) — only a real, successful
 * BillingAccount moves it to ACTIVE.
 */
export const BILLING_PLAN_STATUSES = ["DRAFT", "HUMAN_APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "REJECTED"] as const;
export type BillingPlanStatus = (typeof BILLING_PLAN_STATUSES)[number];

export function isBillingPlanStatus(value: string): value is BillingPlanStatus {
  return (BILLING_PLAN_STATUSES as readonly string[]).includes(value);
}

export const BILLING_PLAN_STATUS_TRANSITIONS: TransitionTable<BillingPlanStatus> = {
  DRAFT: ["HUMAN_APPROVED", "REJECTED"],
  HUMAN_APPROVED: ["ACTIVE"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  REJECTED: [],
};

import type { TransitionTable } from "../shared/state-machine.js";

export const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MODIFIED",
  "DEFERRED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function isApprovalStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(value);
}

/**
 * DEFERRED -> PENDING models "REQUEST_MORE_EVIDENCE" (Constitution
 * §16/§28): the Human Owner defers, more evidence is attached, and the
 * request re-enters the queue. Every other resolved status is terminal.
 */
export const APPROVAL_STATUS_TRANSITIONS: TransitionTable<ApprovalStatus> = {
  PENDING: ["APPROVED", "REJECTED", "MODIFIED", "DEFERRED", "CANCELLED", "EXPIRED"],
  DEFERRED: ["PENDING", "CANCELLED", "EXPIRED"],
  APPROVED: [],
  REJECTED: [],
  MODIFIED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** The five actions the Human Decision Queue exposes (Constitution §16/§28). */
export const DECISION_ACTIONS = ["APPROVE", "REJECT", "MODIFY", "DEFER", "REQUEST_MORE_EVIDENCE"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

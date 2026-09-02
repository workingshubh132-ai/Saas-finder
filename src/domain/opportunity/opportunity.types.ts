import type { TransitionTable } from "../shared/state-machine.js";

export const OPPORTUNITY_STATUSES = [
  "DISCOVERED",
  "RESEARCHING",
  "VALIDATING",
  "VALIDATED",
  "APPROVED",
  "REJECTED",
  "KILLED",
  "ARCHIVED",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export function isOpportunityStatus(value: string): value is OpportunityStatus {
  return (OPPORTUNITY_STATUSES as readonly string[]).includes(value);
}

/**
 * ARCHIVED is the one terminal state, reachable from anywhere
 * non-terminal. M4 (docs/M4_ARCHITECTURE_PROPOSAL.md §18) adds exactly
 * one value, KILLED, reachable from every non-terminal state alongside
 * ARCHIVED — set only by `decisionRecordService.applyHumanDecision`
 * once a `KILL_OPPORTUNITY` ApprovalRequest is APPROVED, never
 * automatically. KILLED itself only ever moves to ARCHIVED (cleanup) —
 * a killed opportunity is never "un-killed" by transition; reopening a
 * decision is a fresh re-evaluation, not a status reversal, keeping
 * history honest. CHAIRMAN_REVIEW/HUMAN_REVIEW were deliberately NOT
 * added as statuses — both are already fully represented by a
 * ChairmanReview row existing / a PENDING ApprovalRequest existing, so
 * adding a status for either would be the parallel, conflicting state
 * machine the M4 brief warns against (§18).
 */
export const OPPORTUNITY_STATUS_TRANSITIONS: TransitionTable<OpportunityStatus> = {
  DISCOVERED: ["RESEARCHING", "KILLED", "ARCHIVED"],
  RESEARCHING: ["VALIDATING", "KILLED", "ARCHIVED"],
  VALIDATING: ["VALIDATED", "REJECTED", "KILLED", "ARCHIVED"],
  VALIDATED: ["APPROVED", "REJECTED", "KILLED", "ARCHIVED"],
  APPROVED: ["KILLED", "ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  KILLED: ["ARCHIVED"],
  ARCHIVED: [],
};

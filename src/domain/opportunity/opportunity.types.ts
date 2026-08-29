import type { TransitionTable } from "../shared/state-machine.js";

export const OPPORTUNITY_STATUSES = [
  "DISCOVERED",
  "RESEARCHING",
  "VALIDATING",
  "VALIDATED",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export function isOpportunityStatus(value: string): value is OpportunityStatus {
  return (OPPORTUNITY_STATUSES as readonly string[]).includes(value);
}

/** ARCHIVED is the one terminal state, reachable from anywhere non-terminal. */
export const OPPORTUNITY_STATUS_TRANSITIONS: TransitionTable<OpportunityStatus> = {
  DISCOVERED: ["RESEARCHING", "ARCHIVED"],
  RESEARCHING: ["VALIDATING", "ARCHIVED"],
  VALIDATING: ["VALIDATED", "REJECTED", "ARCHIVED"],
  VALIDATED: ["APPROVED", "REJECTED", "ARCHIVED"],
  APPROVED: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  ARCHIVED: [],
};

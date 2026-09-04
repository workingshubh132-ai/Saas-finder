import type { TransitionTable } from "../shared/state-machine.js";

/** Support case lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §25). */
export const SUPPORT_CASE_STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "ESCALATED"] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export function isSupportCaseStatus(value: string): value is SupportCaseStatus {
  return (SUPPORT_CASE_STATUSES as readonly string[]).includes(value);
}

export const SUPPORT_CASE_STATUS_TRANSITIONS: TransitionTable<SupportCaseStatus> = {
  OPEN: ["TRIAGED"],
  TRIAGED: ["IN_PROGRESS", "ESCALATED"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED", "ESCALATED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "ESCALATED"],
  RESOLVED: ["IN_PROGRESS"],
  ESCALATED: ["IN_PROGRESS", "RESOLVED"],
};

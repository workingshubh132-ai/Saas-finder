import type { TransitionTable } from "../shared/state-machine.js";

/**
 * OutreachMessage lifecycle (docs/M5_ARCHITECTURE_PROPOSAL.md §12-13).
 * CONTACTED is a human-confirmed record-keeping transition only — no
 * code path in this system ever sends anything externally
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §13).
 */
export const OUTREACH_MESSAGE_STATUSES = ["DRAFT", "AWAITING_HUMAN_APPROVAL", "APPROVED_TO_CONTACT", "REJECTED", "CONTACTED", "CANCELLED"] as const;
export type OutreachMessageStatus = (typeof OUTREACH_MESSAGE_STATUSES)[number];

export function isOutreachMessageStatus(value: string): value is OutreachMessageStatus {
  return (OUTREACH_MESSAGE_STATUSES as readonly string[]).includes(value);
}

export const OUTREACH_MESSAGE_STATUS_TRANSITIONS: TransitionTable<OutreachMessageStatus> = {
  DRAFT: ["AWAITING_HUMAN_APPROVAL", "CANCELLED"],
  AWAITING_HUMAN_APPROVAL: ["APPROVED_TO_CONTACT", "REJECTED", "CANCELLED"],
  APPROVED_TO_CONTACT: ["CONTACTED", "CANCELLED"],
  REJECTED: [],
  CONTACTED: [],
  CANCELLED: [],
};

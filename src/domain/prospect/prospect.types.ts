import type { TransitionTable } from "../shared/state-machine.js";

/**
 * Prospect lifecycle (docs/M5_ARCHITECTURE_PROPOSAL.md §8) — the
 * brief's own list, kept as the minimum state machine necessary.
 * DO_NOT_CONTACT is reachable from every non-terminal state: a human
 * or a policy check can pull a prospect out of the pipeline at any
 * point, never only at specific checkpoints.
 */
export const PROSPECT_STATUSES = [
  "DISCOVERED",
  "QUALIFIED",
  "REJECTED",
  "APPROVED_FOR_DRAFT",
  "DRAFT_READY",
  "AWAITING_HUMAN_APPROVAL",
  "APPROVED_TO_CONTACT",
  "CONTACTED",
  "RESPONDED",
  "NO_RESPONSE",
  "DO_NOT_CONTACT",
  "COMPLETED",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export function isProspectStatus(value: string): value is ProspectStatus {
  return (PROSPECT_STATUSES as readonly string[]).includes(value);
}

const DO_NOT_CONTACT: readonly ProspectStatus[] = ["DO_NOT_CONTACT"];

export const PROSPECT_STATUS_TRANSITIONS: TransitionTable<ProspectStatus> = {
  DISCOVERED: ["QUALIFIED", "REJECTED", ...DO_NOT_CONTACT],
  QUALIFIED: ["APPROVED_FOR_DRAFT", "REJECTED", ...DO_NOT_CONTACT],
  APPROVED_FOR_DRAFT: ["DRAFT_READY", ...DO_NOT_CONTACT],
  DRAFT_READY: ["AWAITING_HUMAN_APPROVAL", ...DO_NOT_CONTACT],
  AWAITING_HUMAN_APPROVAL: ["APPROVED_TO_CONTACT", "REJECTED", ...DO_NOT_CONTACT],
  APPROVED_TO_CONTACT: ["CONTACTED", ...DO_NOT_CONTACT],
  CONTACTED: ["RESPONDED", "NO_RESPONSE", ...DO_NOT_CONTACT],
  RESPONDED: ["COMPLETED", ...DO_NOT_CONTACT],
  NO_RESPONSE: ["COMPLETED", ...DO_NOT_CONTACT],
  REJECTED: [],
  DO_NOT_CONTACT: [],
  COMPLETED: [],
};

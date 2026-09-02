import type { TransitionTable } from "../shared/state-machine.js";

/**
 * OutreachExperiment lifecycle (docs/M5_ARCHITECTURE_PROPOSAL.md §11)
 * — PENDING_APPROVAL is the first hard human gate in the M5 core loop:
 * no Prospect may enter APPROVED_FOR_DRAFT under an experiment that
 * isn't ACTIVE.
 */
export const OUTREACH_EXPERIMENT_STATUSES = ["PENDING_APPROVAL", "ACTIVE", "COMPLETED", "STOPPED", "CANCELLED"] as const;
export type OutreachExperimentStatus = (typeof OUTREACH_EXPERIMENT_STATUSES)[number];

export function isOutreachExperimentStatus(value: string): value is OutreachExperimentStatus {
  return (OUTREACH_EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

export const OUTREACH_EXPERIMENT_STATUS_TRANSITIONS: TransitionTable<OutreachExperimentStatus> = {
  PENDING_APPROVAL: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "STOPPED", "CANCELLED"],
  COMPLETED: [],
  STOPPED: [],
  CANCELLED: [],
};

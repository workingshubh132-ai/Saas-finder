import type { TransitionTable } from "../shared/state-machine.js";

/** One bounded, reviewable unit of engineering work (docs/M6_ARCHITECTURE_PROPOSAL.md §12). */
export const ENGINEERING_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type EngineeringTaskStatus = (typeof ENGINEERING_TASK_STATUSES)[number];

export function isEngineeringTaskStatus(value: string): value is EngineeringTaskStatus {
  return (ENGINEERING_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * FAILED -> IN_PROGRESS is the one bounded-retry edge (§28) — gated at
 * the service layer by EngineeringTask.attemptCount < MAX_TASK_ATTEMPTS,
 * never by the state machine alone (a state machine can't count).
 * FAILED -> CANCELLED is what a second failure (attempt cap exceeded)
 * actually does — the task stops, Product moves to HUMAN_REVIEW (or
 * FAILED, per productFactoryService), never an unbounded loop.
 */
export const ENGINEERING_TASK_STATUS_TRANSITIONS: TransitionTable<EngineeringTaskStatus> = {
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "FAILED"],
  FAILED: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const MAX_TASK_ATTEMPTS = 2;

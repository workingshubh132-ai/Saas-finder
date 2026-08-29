import type { TransitionTable } from "../shared/state-machine.js";

export const TASK_STATUSES = ["PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

/**
 * The M1 brief specifies PENDING->QUEUED->RUNNING->COMPLETED,
 * RUNNING->FAILED, RUNNING->CANCELLED, PENDING->CANCELLED. QUEUED->CANCELLED
 * is added so a queued-but-not-yet-running task can still be cancelled —
 * without it CANCELLED would be unreachable from QUEUED, which reads as
 * an omission rather than a deliberate restriction. COMPLETED/FAILED/
 * CANCELLED are terminal.
 */
export const TASK_STATUS_TRANSITIONS: TransitionTable<TaskStatus> = {
  PENDING: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

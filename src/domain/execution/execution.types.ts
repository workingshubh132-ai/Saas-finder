import type { TransitionTable } from "../shared/state-machine.js";

/** Agent execution lifecycle (M2 brief Part 5). */
export const EXECUTION_STATUSES = [
  "CREATED",
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_TOOL",
  "PROCESSING_RESULT",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export function isExecutionStatus(value: string): value is ExecutionStatus {
  return (EXECUTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The brief's literal example is CREATED->QUEUED->RUNNING->
 * WAITING_FOR_TOOL->PROCESSING_RESULT->COMPLETED, RUNNING->FAILED,
 * RUNNING->CANCELLED, WAITING_FOR_TOOL->FAILED. Extended, in the same
 * spirit as M1's Task/Approval tables, so every non-terminal state can
 * reach CANCELLED, WAITING_FOR_TOOL can return to RUNNING (the runtime
 * alternates RUNNING/WAITING_FOR_TOOL once per tool call, not once per
 * execution), and RUNNING can go straight to PROCESSING_RESULT or
 * COMPLETED for a run that needed no tool call.
 */
export const EXECUTION_STATUS_TRANSITIONS: TransitionTable<ExecutionStatus> = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_FOR_TOOL", "PROCESSING_RESULT", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_TOOL: ["RUNNING", "FAILED", "CANCELLED"],
  PROCESSING_RESULT: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TOOL_EXECUTION_STATUSES = ["SUCCESS", "FAILED"] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];

export function isToolExecutionStatus(value: string): value is ToolExecutionStatus {
  return (TOOL_EXECUTION_STATUSES as readonly string[]).includes(value);
}

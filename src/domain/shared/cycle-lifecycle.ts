import type { TransitionTable } from "./state-machine.js";

/**
 * The bounded-cycle lifecycle shape shared by every orchestration
 * boundary in VentureForge — `ResearchCycle` (M3) and `DecisionCycle`
 * (M4, docs/M4_ARCHITECTURE_PROPOSAL.md §21). Factored out once a
 * second cycle type needed the identical shape rather than forked:
 * `AWAITING_HUMAN`'s one real producer (the cycle's assigned agent
 * currently lacks a grant it needs before the cycle can even start)
 * and `STOPPED`'s "every row already committed stays intact" meaning
 * (docs/RESEARCH_SCHEDULING.md) are the same fact for both cycle
 * types, so a future change to either applies to both automatically
 * instead of silently drifting apart.
 */
export const CYCLE_STATUSES = [
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "STOPPED",
  "AWAITING_HUMAN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export function isCycleStatus(value: string): value is CycleStatus {
  return (CYCLE_STATUSES as readonly string[]).includes(value);
}

export const CYCLE_STATUS_TRANSITIONS: TransitionTable<CycleStatus> = {
  SCHEDULED: ["RUNNING", "AWAITING_HUMAN", "CANCELLED"],
  AWAITING_HUMAN: ["SCHEDULED", "RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "STOPPED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "STOPPED", "CANCELLED"],
  STOPPED: [],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

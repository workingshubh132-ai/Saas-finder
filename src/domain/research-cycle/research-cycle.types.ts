import type { TransitionTable } from "../shared/state-machine.js";

/**
 * M3 brief Part 29 (Operating Window) folded into one lifecycle with
 * Part 28 (Research Cycle) — the same bounded unit of work
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §16). AWAITING_HUMAN has exactly
 * one real producer in M3: a cycle whose assigned agent currently
 * lacks the grant it needs to even start (researchCycleService).
 * STOPPED is where a budget-exhausted cycle lands, with every row
 * already committed left intact (Part 38) — never rolled back.
 */
export const RESEARCH_CYCLE_STATUSES = [
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "STOPPED",
  "AWAITING_HUMAN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ResearchCycleStatus = (typeof RESEARCH_CYCLE_STATUSES)[number];

export function isResearchCycleStatus(value: string): value is ResearchCycleStatus {
  return (RESEARCH_CYCLE_STATUSES as readonly string[]).includes(value);
}

export const RESEARCH_CYCLE_STATUS_TRANSITIONS: TransitionTable<ResearchCycleStatus> = {
  SCHEDULED: ["RUNNING", "AWAITING_HUMAN", "CANCELLED"],
  AWAITING_HUMAN: ["SCHEDULED", "RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "STOPPED", "COMPLETED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "STOPPED", "CANCELLED"],
  STOPPED: [],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

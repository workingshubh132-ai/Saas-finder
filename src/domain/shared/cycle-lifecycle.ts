import type { TransitionTable } from "./state-machine.js";

/**
 * The bounded-cycle lifecycle shape shared by every orchestration
 * boundary in VentureForge — `ResearchCycle` (M3), `DecisionCycle` (M4,
 * docs/M4_ARCHITECTURE_PROPOSAL.md §21), and `OperatingCycle` (M9,
 * docs/M9_ARCHITECTURE_PROPOSAL.md §15, this table's third consumer).
 * Factored out once a second cycle type needed the identical shape
 * rather than forked: `STOPPED`'s "every row already committed stays
 * intact" meaning (docs/RESEARCH_SCHEDULING.md) is the same fact for
 * every cycle type, so a future change applies to all of them
 * automatically instead of silently drifting apart.
 *
 * `RUNNING -> AWAITING_HUMAN` is genuinely new as of M9: for M3/M4,
 * AWAITING_HUMAN has exactly one producer — a pre-flight permission
 * gate reachable only from SCHEDULED, before the cycle's real work
 * begins. M9's OperatingCycle needs a second, different producer this
 * table never had to express before: ANY stage may request human
 * review mid-flight, while status is already RUNNING
 * (schedulerService.routeToAwaitingHuman) — a real gap this build
 * caught (tests/integration/m9-capstone-operating-cycle.test.ts): the
 * edge was simply missing, so every such request threw
 * InvalidTransitionError before this fix. Adding it here is safe for
 * M3/M4 too — neither research-cycle.service.ts nor
 * decision-cycle.service.ts has any code path that requests
 * AWAITING_HUMAN while RUNNING, so the new edge is legal-but-unused
 * for both, never silently changing their existing behavior.
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
  RUNNING: ["PAUSED", "STOPPED", "COMPLETED", "FAILED", "CANCELLED", "AWAITING_HUMAN"],
  PAUSED: ["RUNNING", "STOPPED", "CANCELLED"],
  STOPPED: [],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

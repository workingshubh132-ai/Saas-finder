import type { TransitionTable } from "../shared/state-machine.js";
import { CYCLE_STATUSES, CYCLE_STATUS_TRANSITIONS, isCycleStatus, type CycleStatus } from "../shared/cycle-lifecycle.js";

/**
 * M3 brief Part 29 (Operating Window) folded into one lifecycle with
 * Part 28 (Research Cycle) — the same bounded unit of work
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §16). AWAITING_HUMAN has exactly
 * one real producer in M3: a cycle whose assigned agent currently
 * lacks the grant it needs to even start (researchCycleService).
 * STOPPED is where a budget-exhausted cycle lands, with every row
 * already committed left intact (Part 38) — never rolled back.
 *
 * M4 (docs/M4_ARCHITECTURE_PROPOSAL.md §21) needed the identical
 * lifecycle for `DecisionCycle`, so this is now a thin re-export of
 * the shared `domain/shared/cycle-lifecycle.ts` constant rather than
 * its own copy — a change to the shared shape applies to both cycle
 * types automatically. Names kept identical to before the refactor;
 * no caller of this file changes.
 */
export const RESEARCH_CYCLE_STATUSES = CYCLE_STATUSES;
export type ResearchCycleStatus = CycleStatus;

export const isResearchCycleStatus: (value: string) => value is ResearchCycleStatus = isCycleStatus;

export const RESEARCH_CYCLE_STATUS_TRANSITIONS: TransitionTable<ResearchCycleStatus> = CYCLE_STATUS_TRANSITIONS;

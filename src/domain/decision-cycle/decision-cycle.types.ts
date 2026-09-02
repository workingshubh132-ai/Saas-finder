import type { TransitionTable } from "../shared/state-machine.js";
import { CYCLE_STATUSES, CYCLE_STATUS_TRANSITIONS, isCycleStatus, type CycleStatus } from "../shared/cycle-lifecycle.js";

/**
 * `DecisionCycle` (docs/M4_ARCHITECTURE_PROPOSAL.md §16, §21, §25) —
 * the CEO-pipeline sibling of `ResearchCycle`, entry-pointed on an
 * existing `opportunityId` rather than a cold-start objective. Shares
 * the identical bounded-cycle lifecycle (`domain/shared/cycle-lifecycle.ts`):
 * `AWAITING_HUMAN` is a real producer here too — the Evidence Validator
 * needs `READ_WEB` exactly like the Research/Competitor Analysts, so an
 * ungranted Validator hits the same pre-RUNNING authorization check a
 * research cycle would.
 */
export const DECISION_CYCLE_STATUSES = CYCLE_STATUSES;
export type DecisionCycleStatus = CycleStatus;

export const isDecisionCycleStatus: (value: string) => value is DecisionCycleStatus = isCycleStatus;

export const DECISION_CYCLE_STATUS_TRANSITIONS: TransitionTable<DecisionCycleStatus> = CYCLE_STATUS_TRANSITIONS;

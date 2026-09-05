import type { TransitionTable } from "../shared/state-machine.js";

/**
 * Company-level operating cycle lifecycle (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §15). Two independent axes, not one: `status` reuses
 * src/domain/shared/cycle-lifecycle.ts's own CYCLE_STATUSES/
 * CYCLE_STATUS_TRANSITIONS verbatim (OperatingCycle is that module's
 * THIRD consumer, after ResearchCycle/DecisionCycle — see that file's
 * own doc comment); `stage` is this file's own, genuinely new concept:
 * which phase of company-level work is happening while status=RUNNING.
 * The M9 brief's own §2 list, verbatim.
 */
export const CYCLE_STAGES = [
  "CREATED",
  "PLANNING",
  "RESEARCHING",
  "ANALYZING",
  "DECIDING",
  "AWAITING_HUMAN",
  "EXECUTING",
  "OBSERVING",
  "LEARNING",
  "COMPLETED",
] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

export function isCycleStage(value: string): value is CycleStage {
  return (CYCLE_STAGES as readonly string[]).includes(value);
}

/**
 * Linear-only, with exactly one branch: any stage may move to
 * AWAITING_HUMAN (a human decision is needed before this specific
 * stage can complete), and AWAITING_HUMAN returns to the stage that
 * requested it once decided — the caller supplies which stage that
 * was; this table only proves the jump itself is legal.
 */
export const CYCLE_STAGE_TRANSITIONS: TransitionTable<CycleStage> = {
  CREATED: ["PLANNING", "AWAITING_HUMAN"],
  PLANNING: ["RESEARCHING", "AWAITING_HUMAN"],
  RESEARCHING: ["ANALYZING", "AWAITING_HUMAN"],
  ANALYZING: ["DECIDING", "AWAITING_HUMAN"],
  DECIDING: ["AWAITING_HUMAN", "EXECUTING"],
  AWAITING_HUMAN: ["PLANNING", "RESEARCHING", "ANALYZING", "DECIDING", "EXECUTING", "OBSERVING", "LEARNING"],
  EXECUTING: ["OBSERVING", "AWAITING_HUMAN"],
  OBSERVING: ["LEARNING"],
  LEARNING: ["COMPLETED"],
  COMPLETED: [],
} as const;

/**
 * A resumable cycle preserves `stage` across PAUSED/STOPPED/FAILED —
 * resuming re-enters exactly that stage, never restarts at CREATED
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §15's own explicit definition of
 * "bounded and resumable"). retryCycle (§17) resumes at the stage
 * AFTER the last one a real CycleStageEvent recorded as completed —
 * this function only says which stage a resume/retry should target
 * given the history, never mutates anything itself.
 */
export function resolveResumeStage(completedStages: readonly CycleStage[]): CycleStage {
  const order = CYCLE_STAGES;
  let furthest = -1;
  for (const stage of completedStages) {
    const index = order.indexOf(stage);
    if (index > furthest) furthest = index;
  }
  const next = order[furthest + 1];
  return next ?? "COMPLETED";
}

export const CYCLE_KINDS = ["SCHEDULED", "MANUAL", "RESUMED", "RETRIED"] as const;
export type CycleKind = (typeof CYCLE_KINDS)[number];

export function isCycleKind(value: string): value is CycleKind {
  return (CYCLE_KINDS as readonly string[]).includes(value);
}

/** Every scheduled action must carry all seven (M9 brief §4, verbatim). */
export interface OperatingCycleDefinition {
  readonly objective: string;
  readonly scope: string;
  readonly maxCostUsd: number;
  readonly riskLevel: string;
  readonly deadline: Date | null;
  readonly owner: string;
}

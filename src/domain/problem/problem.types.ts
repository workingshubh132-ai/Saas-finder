import type { TransitionTable } from "../shared/state-machine.js";

/**
 * M3 brief Part 11. INSUFFICIENT_EVIDENCE is the honest outcome (Part
 * 43) when a cluster doesn't support a real Problem — not an error,
 * a normal terminal-for-now classification a future cluster update
 * could revisit. PROMOTED means an Opportunity candidate has been
 * generated from it (docs/M3_ARCHITECTURE_PROPOSAL.md §7, §9).
 */
export const PROBLEM_STATUSES = ["CANDIDATE", "PROMOTED", "INSUFFICIENT_EVIDENCE", "REJECTED", "ARCHIVED"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export function isProblemStatus(value: string): value is ProblemStatus {
  return (PROBLEM_STATUSES as readonly string[]).includes(value);
}

/**
 * CANDIDATE is the only non-terminal state that can still move
 * forward (to PROMOTED) or be found wanting (INSUFFICIENT_EVIDENCE,
 * REJECTED). A later re-analysis of the same cluster (more signals
 * arrived) can move INSUFFICIENT_EVIDENCE back to CANDIDATE rather
 * than being stuck — the underlying cluster is still ACTIVE and can
 * still gain more signals over time.
 */
export const PROBLEM_STATUS_TRANSITIONS: TransitionTable<ProblemStatus> = {
  CANDIDATE: ["PROMOTED", "INSUFFICIENT_EVIDENCE", "REJECTED", "ARCHIVED"],
  INSUFFICIENT_EVIDENCE: ["CANDIDATE", "ARCHIVED"],
  PROMOTED: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  ARCHIVED: [],
};

import type { CompanyAction } from "../company-action/company-action.types.js";

/**
 * Concurrency conflict detection (docs/M9_ARCHITECTURE_PROPOSAL.md §40,
 * M9 brief §28) — a read-time check with a human-visible flag, never a
 * database lock (this codebase has no distributed-lock infrastructure,
 * and its actual write concurrency — SQLite, WAL mode, one process —
 * doesn't need one, docs/DECISIONS.md #61's own "smallest correct
 * model" precedent). Two CeoRecommendations for the same resource
 * "conflict" when their actions pull in opposite directions — INVEST
 * vs. INVEST is not a conflict; INVEST vs. PAUSE is.
 */
const EXPANSIVE_ACTIONS: ReadonlySet<CompanyAction> = new Set(["INVEST", "GROW", "RUN_EXPERIMENT", "BUILD", "RESEARCH", "RUN_CUSTOMER_DISCOVERY", "IMPROVE_PRODUCT"]);
const CONTRACTIVE_ACTIONS: ReadonlySet<CompanyAction> = new Set(["PAUSE", "REDUCE_COST", "PREPARE_KILL_REVIEW"]);

export function isConflictingAction(a: CompanyAction, b: CompanyAction): boolean {
  if (a === b) return false;
  return (EXPANSIVE_ACTIONS.has(a) && CONTRACTIVE_ACTIONS.has(b)) || (CONTRACTIVE_ACTIONS.has(a) && EXPANSIVE_ACTIONS.has(b));
}

/**
 * The CEO's sixth, company-level decision axis
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §31-32, M9 brief §19-20) — reuses
 * an existing action STRING wherever the underlying concept already
 * exists (docs/DECISIONS.md #67's own precedent), never a parallel
 * synonym in the shared ceo_recommendations.action column. Only
 * RESEARCH, GROW, and company-level PAUSE are genuinely new.
 */
export const COMPANY_ACTIONS = [
  "RESEARCH",
  "RUN_CUSTOMER_DISCOVERY",
  "BUILD",
  "IMPROVE_PRODUCT",
  "RUN_EXPERIMENT",
  "GROW",
  "REDUCE_COST",
  "INVEST",
  "MAINTAIN",
  "PAUSE",
  "PREPARE_KILL_REVIEW",
] as const;
export type CompanyAction = (typeof COMPANY_ACTIONS)[number];

export function isCompanyAction(value: string): value is CompanyAction {
  return (COMPANY_ACTIONS as readonly string[]).includes(value);
}

/** The three genuinely new strings requiring a ceo_recommendations.action CHECK widening (the other eight already exist). */
export const NEW_COMPANY_ACTION_STRINGS: ReadonlySet<CompanyAction> = new Set(["RESEARCH", "GROW", "PAUSE"]);

export type ConflictResolution = "PROCEED" | "CONFLICTED";

/**
 * CEO vs. Chairman disagreement (docs/M9_ARCHITECTURE_PROPOSAL.md §34,
 * M9 brief §22) — STOP -> HUMAN REVIEW is the ONLY terminal state for
 * a real conflict; never an automatic pick of either side. Exhaustive
 * over every CompanyAction (a unit test asserts this) so a newly added
 * action can never silently default to "no declared conflict"
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §60's own named risk).
 */
const ACTIONS_CONFLICTING_WITH_REJECT: ReadonlySet<CompanyAction> = new Set([
  "INVEST",
  "GROW",
  "RUN_EXPERIMENT",
  "BUILD",
  "RESEARCH",
  "RUN_CUSTOMER_DISCOVERY",
  "IMPROVE_PRODUCT",
]);

export function resolveCeoChairmanConflict(ceoAction: CompanyAction, chairmanDecision: string): ConflictResolution {
  if (chairmanDecision === "APPROVE") return "PROCEED";
  if (chairmanDecision === "REQUEST_CHANGES" || chairmanDecision === "ESCALATE_TO_HUMAN") return "CONFLICTED";
  if (chairmanDecision === "REJECT" && ACTIONS_CONFLICTING_WITH_REJECT.has(ceoAction)) return "CONFLICTED";
  if (chairmanDecision === "REQUEST_MORE_EVIDENCE" && (ceoAction === "PREPARE_KILL_REVIEW" || ceoAction === "PAUSE" || ceoAction === "REDUCE_COST")) {
    return "CONFLICTED";
  }
  // REJECT on an already-cautious action (PAUSE/REDUCE_COST/PREPARE_KILL_REVIEW/MAINTAIN), or
  // REQUEST_MORE_EVIDENCE/DEFER on an already-cautious or neutral action, is not a genuine
  // conflict — the Chairman is asking for caution the CEO's own action already reflects.
  return "PROCEED";
}

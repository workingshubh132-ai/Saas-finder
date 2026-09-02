/**
 * The CEO's closed action set (docs/M4_ARCHITECTURE_PROPOSAL.md §13) —
 * exactly the M4 brief's example set, no additions ("do not add
 * actions merely for variety"). None of these performs, or triggers,
 * any real-world effect by itself — see §13's per-action table. In
 * particular `VALIDATE_CUSTOMER` is a recommendation surfaced to the
 * Human Owner only; VentureForge never contacts a customer.
 */
export const CEO_DECISION_ACTIONS = [
  "KILL",
  "DEPRIORITIZE",
  "INVESTIGATE",
  "VALIDATE_CUSTOMER",
  "PREPARE_REVIEW",
  "HUMAN_REVIEW",
] as const;
export type CeoDecisionAction = (typeof CEO_DECISION_ACTIONS)[number];

export function isCeoDecisionAction(value: string): value is CeoDecisionAction {
  return (CEO_DECISION_ACTIONS as readonly string[]).includes(value);
}

/** Actions that produce an `ApprovalRequest` (docs/M4_ARCHITECTURE_PROPOSAL.md §13, §20) — the rest are audit/queue-only, no human gate to cross. */
export const ACTIONS_REQUIRING_APPROVAL: ReadonlySet<CeoDecisionAction> = new Set(["KILL", "PREPARE_REVIEW", "HUMAN_REVIEW"]);

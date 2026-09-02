import type { TransitionTable } from "../shared/state-machine.js";

/**
 * A Claim's validation status (docs/M4_ARCHITECTURE_PROPOSAL.md §5) —
 * exactly the M4 brief's minimum set, no additions. `CONFLICTED` is a
 * first-class outcome (credible support AND credible contradiction,
 * roughly balanced) rather than a tie-break; `INSUFFICIENT_EVIDENCE`
 * is the honest "a validation pass ran and found close to nothing"
 * outcome — never forced toward a false positive or negative.
 */
export const CLAIM_VALIDATION_STATUSES = [
  "UNVERIFIED",
  "SUPPORTED",
  "WEAK",
  "CONTRADICTED",
  "CONFLICTED",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type ClaimValidationStatus = (typeof CLAIM_VALIDATION_STATUSES)[number];

export function isClaimValidationStatus(value: string): value is ClaimValidationStatus {
  return (CLAIM_VALIDATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Deliberately the complete digraph (every state reaches every state,
 * including itself) — the one M4 state machine that breaks from every
 * M1-M3 precedent, all of which have a terminal state because they
 * model a *resource's lifecycle*. A Claim's validation status models
 * the current best reading of an always-open epistemic question: new
 * evidence next month can legitimately move a SUPPORTED claim to WEAK,
 * or a CONTRADICTED claim back toward CONFLICTED, without the earlier
 * evidence on either side ever being deleted (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §5, §6). Still built on the shared `state-machine.ts`/`assertTransition`
 * utility for consistency and auditability — just with every edge
 * present, including self-loops so re-confirming the same status after
 * a fresh validation run is never an illegal transition.
 */
export const CLAIM_VALIDATION_TRANSITIONS: TransitionTable<ClaimValidationStatus> = {
  UNVERIFIED: [...CLAIM_VALIDATION_STATUSES],
  SUPPORTED: [...CLAIM_VALIDATION_STATUSES],
  WEAK: [...CLAIM_VALIDATION_STATUSES],
  CONTRADICTED: [...CLAIM_VALIDATION_STATUSES],
  CONFLICTED: [...CLAIM_VALIDATION_STATUSES],
  INSUFFICIENT_EVIDENCE: [...CLAIM_VALIDATION_STATUSES],
};

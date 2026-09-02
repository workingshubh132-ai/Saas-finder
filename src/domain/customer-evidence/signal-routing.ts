import type { ClaimType } from "../claim/claim.types.js";
import type { CustomerSignalType } from "./customer-signal.types.js";

/**
 * The milestone's most safety-critical single table
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §17, brief §19): which claim types
 * a piece of customer evidence is even ELIGIBLE to validate, keyed by
 * its signal type. Enforced as data, not merely a prompt instruction a
 * model could drift on — INTEREST is never eligible for
 * WILLINGNESS_TO_PAY, full stop, regardless of how enthusiastic its
 * wording is.
 *
 * OBJECTION is deliberately absent here — an objection's relevance is
 * carried by its own `relatedClaimType` field (set by the Response
 * Analyst per-extraction, not this static table), since an objection
 * can legitimately be about any claim type depending on its content.
 */
export const CUSTOMER_SIGNAL_ELIGIBLE_CLAIM_TYPES: Readonly<Partial<Record<CustomerSignalType, readonly ClaimType[]>>> = {
  PAIN: ["CUSTOMER_PROBLEM"],
  FREQUENCY: ["FREQUENCY"],
  URGENCY: ["TIMING"],
  CURRENT_WORKAROUND: ["COMPETITIVE_POSITION", "DIFFERENTIATION"],
  CURRENT_SPENDING: ["WILLINGNESS_TO_PAY", "ECONOMICS"],
  WTP: ["WILLINGNESS_TO_PAY"],
  PURCHASE_AUTHORITY: ["CUSTOMER_SEGMENT", "DISTRIBUTION"],
  INTEREST: ["CUSTOMER_PROBLEM"],
  ALTERNATIVE: ["COMPETITIVE_POSITION"],
  REQUEST: ["DIFFERENTIATION"],
};

/**
 * True only when `signalType` (or, for OBJECTION, `relatedClaimType`)
 * is actually eligible to bear on `claimType` — the structural
 * enforcement of "never treat interest as payment intent."
 */
export function isSignalEligibleForClaim(signalType: CustomerSignalType, claimType: ClaimType, relatedClaimType?: ClaimType | null): boolean {
  if (signalType === "OBJECTION") return relatedClaimType === claimType;
  return (CUSTOMER_SIGNAL_ELIGIBLE_CLAIM_TYPES[signalType] ?? []).includes(claimType);
}

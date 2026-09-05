import type { ResponseClassification } from "../customer-response/customer-response.types.js";

/**
 * The bounded follow-up policy the brief's item 13 asks for — a pure,
 * deterministic eligibility check, never itself drafting or sending
 * anything. Deliberately conservative: outreach still requires the
 * existing human approval gate for every message this produces, this
 * only decides whether ASKING for a follow-up is even appropriate.
 *
 * Every one of `NOT_INTERESTED`/`NEGATIVE_SIGNAL`/`OBJECTION` is
 * treated as an explicit stop signal — the closest real mapping this
 * codebase's own `ResponseClassification` (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §15) has to "unsubscribe" or "no-contact request," since no separate
 * do-not-contact flag exists yet (a real gap, named rather than
 * assumed away — see docs/AUTONOMOUS_OPERATIONS_AUDIT.md).
 */
export const MAX_FOLLOW_UPS = 2;
export const MIN_FOLLOW_UP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

const STOP_CLASSIFICATIONS: ReadonlySet<ResponseClassification> = new Set(["NOT_INTERESTED", "NEGATIVE_SIGNAL", "OBJECTION"]);

export interface FollowUpEligibilitySignals {
  readonly priorMessageCount: number;
  readonly lastSentAt: Date | null;
  readonly latestResponseClassification: ResponseClassification | null;
  readonly now: Date;
}

export interface FollowUpEligibility {
  readonly eligible: boolean;
  readonly reason: string;
}

export function checkFollowUpEligibility(signals: FollowUpEligibilitySignals): FollowUpEligibility {
  if (signals.priorMessageCount > MAX_FOLLOW_UPS) {
    return { eligible: false, reason: `Already sent ${signals.priorMessageCount} message(s) — the ${MAX_FOLLOW_UPS}-follow-up bound is reached.` };
  }
  if (signals.latestResponseClassification && STOP_CLASSIFICATIONS.has(signals.latestResponseClassification)) {
    return { eligible: false, reason: `Prior response classified ${signals.latestResponseClassification} — no further contact.` };
  }
  if (signals.lastSentAt && signals.now.getTime() - signals.lastSentAt.getTime() < MIN_FOLLOW_UP_DELAY_MS) {
    const remainingMs = MIN_FOLLOW_UP_DELAY_MS - (signals.now.getTime() - signals.lastSentAt.getTime());
    return { eligible: false, reason: `Minimum delay not yet elapsed — ${Math.ceil(remainingMs / (60 * 60 * 1000))}h remaining.` };
  }
  return { eligible: true, reason: "Eligible for a follow-up draft (still requires the existing human approval gate to actually send)." };
}

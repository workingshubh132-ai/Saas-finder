/**
 * Possible Chairman decisions (M2 brief Part 15). Not a lifecycle — each
 * review is one immutable row. REQUEST_CHANGES was added in M6
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §33) for product/code-thesis
 * reviews specifically — "the implementation needs rework before I'd
 * approve" is a genuinely different verdict from REQUEST_MORE_EVIDENCE's
 * "I need more evidence about the opportunity itself," so it is a new
 * value on the one shared enum, not a parallel one. No M1-M5 dev
 * fixture ever needs to emit it.
 */
export const CHAIRMAN_DECISIONS = ["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE", "REQUEST_CHANGES", "DEFER", "ESCALATE_TO_HUMAN"] as const;
export type ChairmanDecision = (typeof CHAIRMAN_DECISIONS)[number];

export function isChairmanDecision(value: string): value is ChairmanDecision {
  return (CHAIRMAN_DECISIONS as readonly string[]).includes(value);
}

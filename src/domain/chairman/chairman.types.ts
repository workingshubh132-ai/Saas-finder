/** Possible Chairman decisions (M2 brief Part 15). Not a lifecycle — each review is one immutable row. */
export const CHAIRMAN_DECISIONS = ["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE", "DEFER", "ESCALATE_TO_HUMAN"] as const;
export type ChairmanDecision = (typeof CHAIRMAN_DECISIONS)[number];

export function isChairmanDecision(value: string): value is ChairmanDecision {
  return (CHAIRMAN_DECISIONS as readonly string[]).includes(value);
}

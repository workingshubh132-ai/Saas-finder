/** Human decisions on a compiled BusinessReviewMemo (docs/M8_ARCHITECTURE_PROPOSAL.md §23, §25) — mirrors LaunchReviewMemo/ProductReviewMemo's own shape exactly. */
export const BUSINESS_REVIEW_HUMAN_DECISIONS = ["APPROVE", "REQUEST_CHANGES", "REJECT", "DEFER"] as const;
export type BusinessReviewHumanDecision = (typeof BUSINESS_REVIEW_HUMAN_DECISIONS)[number];

export function isBusinessReviewHumanDecision(value: string): value is BusinessReviewHumanDecision {
  return (BUSINESS_REVIEW_HUMAN_DECISIONS as readonly string[]).includes(value);
}

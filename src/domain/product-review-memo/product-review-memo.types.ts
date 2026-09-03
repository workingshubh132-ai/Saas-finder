/** Human decisions on a compiled ProductReviewMemo (docs/M6_ARCHITECTURE_PROPOSAL.md §23, brief §22). */
export const PRODUCT_REVIEW_HUMAN_DECISIONS = ["APPROVE", "REQUEST_CHANGES", "REJECT", "DEFER"] as const;
export type ProductReviewHumanDecision = (typeof PRODUCT_REVIEW_HUMAN_DECISIONS)[number];

export function isProductReviewHumanDecision(value: string): value is ProductReviewHumanDecision {
  return (PRODUCT_REVIEW_HUMAN_DECISIONS as readonly string[]).includes(value);
}

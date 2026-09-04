/** Human decisions on a compiled LaunchReviewMemo (docs/M7_ARCHITECTURE_PROPOSAL.md §31) — mirrors ProductReviewMemo's own shape exactly. */
export const LAUNCH_REVIEW_HUMAN_DECISIONS = ["APPROVE", "REQUEST_CHANGES", "REJECT", "DEFER"] as const;
export type LaunchReviewHumanDecision = (typeof LAUNCH_REVIEW_HUMAN_DECISIONS)[number];

export function isLaunchReviewHumanDecision(value: string): value is LaunchReviewHumanDecision {
  return (LAUNCH_REVIEW_HUMAN_DECISIONS as readonly string[]).includes(value);
}

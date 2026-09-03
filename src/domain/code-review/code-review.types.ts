/** Code Review finding severities (docs/M6_ARCHITECTURE_PROPOSAL.md §14, brief §15). */
export const REVIEW_FINDING_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW"] as const;
export type ReviewFindingSeverity = (typeof REVIEW_FINDING_SEVERITIES)[number];

export function isReviewFindingSeverity(value: string): value is ReviewFindingSeverity {
  return (REVIEW_FINDING_SEVERITIES as readonly string[]).includes(value);
}

/** Any BLOCKER finding sends the task back to BUILDING (§34's REVIEWING -> BUILDING edge) — never silently waved through. */
export function hasBlockingFinding(severities: readonly ReviewFindingSeverity[]): boolean {
  return severities.includes("BLOCKER");
}

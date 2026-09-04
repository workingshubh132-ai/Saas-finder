/**
 * The Portfolio Analyst's recommendation vocabulary
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §28) — Constitution §19's own
 * literal words, founder-ratified before this milestone was ever
 * specified: "VentureForge may operate multiple SaaS businesses
 * simultaneously. The company should continuously evaluate: SCALE,
 * MAINTAIN, INVESTIGATE, PIVOT, PAUSE, RETIRE." The M8 brief's own
 * suggested labels (ALLOCATE_MORE_ATTENTION/ALLOCATE_MORE_ENGINEERING/
 * ALLOCATE_MORE_MARKETING/MAINTAIN/REDUCE_RESOURCES/PREPARE_KILL_REVIEW)
 * map onto these six verbs rather than existing as a second, competing
 * enum (docs/DECISIONS.md) — SCALE covers both "more engineering" and
 * "more marketing" (the specific resource is in the recommendation's
 * own reasoning text, not a separate action value); REDUCE_RESOURCES
 * is PAUSE; PREPARE_KILL_REVIEW is RETIRE.
 */
export const PORTFOLIO_RECOMMENDATIONS = ["SCALE", "MAINTAIN", "INVESTIGATE", "PIVOT", "PAUSE", "RETIRE"] as const;
export type PortfolioRecommendation = (typeof PORTFOLIO_RECOMMENDATIONS)[number];

export function isPortfolioRecommendation(value: string): value is PortfolioRecommendation {
  return (PORTFOLIO_RECOMMENDATIONS as readonly string[]).includes(value);
}

/**
 * RETIRE and PIVOT are consequential enough that they must never
 * autonomously change anything — they are triggers that call
 * `ceoReasoningService.recommendBusinessAction` for that product
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §28), keeping exactly one
 * governance path (CEO -> Chairman -> Human) rather than a second one
 * that bypasses the CEO.
 */
export const PORTFOLIO_RECOMMENDATIONS_TRIGGERING_CEO_REVIEW: ReadonlySet<PortfolioRecommendation> = new Set([
  "RETIRE",
  "PIVOT",
]);

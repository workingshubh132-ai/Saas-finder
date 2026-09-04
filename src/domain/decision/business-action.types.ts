/**
 * The CEO's business-intelligence action set
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §22) — a fifth, distinct decision
 * axis alongside CEO_DECISION_ACTIONS (M4), CUSTOMER_DISCOVERY_ACTIONS
 * (M5), PRODUCT_BUILD_ACTIONS (M6), and LAUNCH_OPERATIONS_ACTIONS (M7),
 * asked of a LIVE (or PAUSED) product: "given everything we now
 * observe about how this business is actually doing, what should
 * happen next." The M8 brief's own list, verbatim, plus the same
 * trailing REQUEST_HUMAN_REVIEW escalation every prior axis ends with.
 * Every recommendation must cite real claim/metric ids; these are
 * recommendations only, never execution permissions — PREPARE_KILL_REVIEW
 * and KILL both still require Chairman review and a human decision
 * before anything happens (docs/M8_ARCHITECTURE_PROPOSAL.md §24-25).
 */
export const BUSINESS_ACTIONS = [
  "INVEST",
  "IMPROVE_PRODUCT",
  "RUN_EXPERIMENT",
  "CHANGE_PRICING",
  "CHANGE_CHANNEL",
  "INVESTIGATE_CHURN",
  "REDUCE_COST",
  "PAUSE_GROWTH",
  "PREPARE_KILL_REVIEW",
  "KILL",
  "REQUEST_HUMAN_REVIEW",
] as const;
export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

export function isBusinessAction(value: string): value is BusinessAction {
  return (BUSINESS_ACTIONS as readonly string[]).includes(value);
}

/**
 * The claim types M8's business intelligence actually grounds
 * recommendations in (docs/M8_ARCHITECTURE_PROPOSAL.md §21) — shared
 * by both `ceoReasoningService.recommendBusinessAction` and
 * `chairmanService.reviewBusinessAction` so the two never silently
 * diverge on what counts as grounding.
 */
export const BUSINESS_RELEVANT_CLAIM_TYPES: ReadonlySet<string> = new Set([
  "WILLINGNESS_TO_PAY",
  "RETENTION",
  "DISTRIBUTION",
  "ECONOMICS",
  "CUSTOMER_SEGMENT",
  "GROWTH_TRAJECTORY",
]);

/** Actions consequential enough to require a BusinessReviewMemo + human decision before anything downstream happens. */
export const BUSINESS_ACTIONS_REQUIRING_APPROVAL: ReadonlySet<BusinessAction> = new Set([
  "PREPARE_KILL_REVIEW",
  "KILL",
  "REQUEST_HUMAN_REVIEW",
]);

/**
 * Deterministic, founder-revisable prioritization weights
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §22) over BusinessHealth's own
 * dimensions — feeds CEO *reasoning* (a tie-breaker among what a rule
 * order already narrowed down), never a bare "sort by score" ranking
 * presented as a decision. Same documented-constant-table pattern as
 * `DIMENSION_WEIGHTS` in kill-risk-scorer.ts and
 * `CLAIM_IMPORTANCE_WEIGHT` in claim.types.ts.
 */
export const BUSINESS_ACTION_PRIORITY_WEIGHTS = {
  revenueHealth: 0.25,
  growthHealth: 0.2,
  customerHealth: 0.2,
  marginHealth: 0.15,
  evidenceConfidence: 0.1,
  riskInverse: 0.1,
} as const;

export interface BusinessActionPriorityInput {
  readonly revenueHealth: number;
  readonly growthHealth: number;
  readonly customerHealth: number;
  readonly marginHealth: number;
  readonly evidenceConfidence: number;
  readonly risk: number;
}

/**
 * The one place this formula is computed — consumed by both the CEO's
 * per-product prioritization (§22) and the Portfolio Analyst's
 * cross-product ranking (§28), so "how important is this product's
 * situation" is defined exactly once.
 */
export function computeBusinessActionPriorityScore(input: BusinessActionPriorityInput): number {
  return (
    BUSINESS_ACTION_PRIORITY_WEIGHTS.revenueHealth * input.revenueHealth +
    BUSINESS_ACTION_PRIORITY_WEIGHTS.growthHealth * input.growthHealth +
    BUSINESS_ACTION_PRIORITY_WEIGHTS.customerHealth * input.customerHealth +
    BUSINESS_ACTION_PRIORITY_WEIGHTS.marginHealth * input.marginHealth +
    BUSINESS_ACTION_PRIORITY_WEIGHTS.evidenceConfidence * input.evidenceConfidence +
    BUSINESS_ACTION_PRIORITY_WEIGHTS.riskInverse * (1 - input.risk)
  );
}

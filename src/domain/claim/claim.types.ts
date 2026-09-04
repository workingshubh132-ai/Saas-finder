/**
 * `Claim` — the falsifiable unit of assertion underneath an
 * Opportunity's dimension-level scores (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §3). Twelve types matched the M4 brief's own list — "do not create
 * unnecessary claim types" — each traceable to a field VentureForge
 * already computes, never invented content. M8 adds exactly one
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §21): five of the M8 brief's own
 * seven example business conclusions already had a home in the
 * existing twelve (CUSTOMERS_ARE_WILLING_TO_PAY -> WILLINGNESS_TO_PAY,
 * RETENTION_IS_HEALTHY -> RETENTION, CHANNEL_IS_EFFECTIVE ->
 * DISTRIBUTION, MARGIN_IS_SUSTAINABLE -> ECONOMICS,
 * CUSTOMER_SEGMENT_IS_STRONG -> CUSTOMER_SEGMENT); PRODUCT_IS_GROWING/
 * PRODUCT_IS_DECLINING are one dimension in opposite directions
 * (exactly like every existing type already carries either polarity in
 * its free-text `statement`), so GROWTH_TRAJECTORY is the only new
 * type — adding two would have broken "every claim type appears
 * exactly once" in CLAIM_TYPE_IMPORTANCE below.
 */
export const CLAIM_TYPES = [
  "CUSTOMER_PROBLEM",
  "CUSTOMER_SEGMENT",
  "FREQUENCY",
  "WILLINGNESS_TO_PAY",
  "MARKET_SIZE",
  "COMPETITIVE_POSITION",
  "DIFFERENTIATION",
  "DISTRIBUTION",
  "RETENTION",
  "BUILDABILITY",
  "TIMING",
  "ECONOMICS",
  "GROWTH_TRAJECTORY",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export function isClaimType(value: string): value is ClaimType {
  return (CLAIM_TYPES as readonly string[]).includes(value);
}

export const CLAIM_IMPORTANCE_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type ClaimImportance = (typeof CLAIM_IMPORTANCE_LEVELS)[number];

export function isClaimImportance(value: string): value is ClaimImportance {
  return (CLAIM_IMPORTANCE_LEVELS as readonly string[]).includes(value);
}

/**
 * Deterministic, founder-revisable policy table keyed by claim type
 * alone (docs/M4_ARCHITECTURE_PROPOSAL.md §3) — same shape as
 * `kill-risk-scorer.ts`'s `DIMENSION_WEIGHTS`. Every claim type
 * appears exactly once. CRITICAL = failure here invalidates the whole
 * opportunity (no real problem, or nobody would pay); HIGH = failure
 * materially changes viability without necessarily invalidating the
 * problem; MEDIUM = failure usually means smaller/harder, not
 * nonexistent; LOW = already weighted directly into kill-risk
 * (buildability) or the least evidence-grounded, most revisable
 * dimension M3 scores (timing).
 */
export const CLAIM_TYPE_IMPORTANCE: Readonly<Record<ClaimType, ClaimImportance>> = {
  CUSTOMER_PROBLEM: "CRITICAL",
  WILLINGNESS_TO_PAY: "CRITICAL",
  CUSTOMER_SEGMENT: "HIGH",
  DISTRIBUTION: "HIGH",
  COMPETITIVE_POSITION: "HIGH",
  // M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §21) — HIGH: a declining
  // product materially changes viability without necessarily
  // invalidating the original problem, the same reasoning this table's
  // own docstring already uses for its HIGH tier.
  GROWTH_TRAJECTORY: "HIGH",
  FREQUENCY: "MEDIUM",
  MARKET_SIZE: "MEDIUM",
  DIFFERENTIATION: "MEDIUM",
  RETENTION: "MEDIUM",
  ECONOMICS: "MEDIUM",
  BUILDABILITY: "LOW",
  TIMING: "LOW",
};

export function importanceForClaimType(claimType: ClaimType): ClaimImportance {
  return CLAIM_TYPE_IMPORTANCE[claimType];
}

/**
 * Numeric weight per importance level — reused directly by opportunity-level
 * confidence aggregation (§11) and the Expected Information Gain
 * formula (§15), so "how important is this claim" is defined exactly
 * once and consumed everywhere, never re-guessed per formula.
 */
export const CLAIM_IMPORTANCE_WEIGHT: Readonly<Record<ClaimImportance, number>> = {
  CRITICAL: 1.0,
  HIGH: 0.7,
  MEDIUM: 0.4,
  LOW: 0.2,
};

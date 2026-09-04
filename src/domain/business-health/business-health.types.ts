/**
 * Business health as several independent dimensions, never one magical
 * number (docs/M8_ARCHITECTURE_PROPOSAL.md §18-19, Constitution §20's
 * "activity is not success" — TASKS/OUTPUT/CUSTOMERS/REVENUE/PROFIT
 * are distinguished, not blended). A composite score exists for
 * ranking (§28) but every dimension underneath it is preserved and
 * returned alongside it, always.
 */
export interface BusinessHealthDimensions {
  readonly productHealth: number;
  readonly customerHealth: number;
  readonly revenueHealth: number;
  readonly growthHealth: number;
  readonly marginHealth: number;
  readonly operationalHealth: number;
  /** Higher = more risk. Populated from kill intelligence (docs/M8_ARCHITECTURE_PROPOSAL.md §27). */
  readonly risk: number;
  readonly evidenceConfidence: number;
}

export const BUSINESS_HEALTH_STATES = ["UNKNOWN", "EARLY", "PROMISING", "HEALTHY", "STAGNATING", "DECLINING", "CRITICAL"] as const;
export type BusinessHealthState = (typeof BUSINESS_HEALTH_STATES)[number];

export function isBusinessHealthState(value: string): value is BusinessHealthState {
  return (BUSINESS_HEALTH_STATES as readonly string[]).includes(value);
}

export interface BusinessHealthResult {
  readonly dimensions: BusinessHealthDimensions;
  readonly compositeScore: number;
  readonly state: BusinessHealthState;
  readonly reasons: readonly string[];
}

/**
 * Below this evidence confidence, no state judgment is trustworthy —
 * EARLY, regardless of the raw scores. Deliberately set ABOVE 0.3, not
 * AT it: every intelligence agent's own "insufficient data" fallback
 * confidence (product-intelligence.service.ts,
 * revenue-analyst.service.ts, growth-analyst.service.ts,
 * customer-intelligence.service.ts) is exactly 0.3, so a brand-new LIVE
 * product with zero real signal in all four dimensions has
 * evidenceConfidence === 0.3 exactly. A `< 0.3` comparison would miss
 * that exact case and fall through to the raw-score ladder below —
 * where zero signal in every dimension scores as low/high-risk as a
 * genuinely failing business, misclassifying "no evidence yet" as
 * CRITICAL. 0.35 catches the true floor (avg of four 0.3s) while still
 * letting one agent with real data (avg >= 0.375) proceed to the raw
 * score ladder.
 */
const EARLY_EVIDENCE_THRESHOLD = 0.35;
const HEALTHY_SCORE_THRESHOLD = 0.75;
const HEALTHY_MAX_RISK = 0.4;
const PROMISING_SCORE_THRESHOLD = 0.55;
const STAGNATING_GROWTH_CEILING = 0.4;
const CRITICAL_SCORE_CEILING = 0.4;
const CRITICAL_MIN_RISK = 0.6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertUnitInterval(dimensions: BusinessHealthDimensions): void {
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new Error(`[business-health] dimension "${key}" must be a number between 0 and 1 (got ${String(value)}).`);
    }
  }
}

/**
 * Deterministic weighted composite (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §18) — documented weights, not hidden, mirroring
 * BUSINESS_ACTION_PRIORITY_WEIGHTS' own shape (a genuinely different
 * formula for a genuinely different question: this describes the
 * business's current state; that one prioritizes what to do about it).
 */
const HEALTH_WEIGHTS: Readonly<Record<Exclude<keyof BusinessHealthDimensions, "risk" | "evidenceConfidence">, number>> = {
  productHealth: 0.2,
  customerHealth: 0.2,
  revenueHealth: 0.25,
  growthHealth: 0.15,
  marginHealth: 0.1,
  operationalHealth: 0.1,
};

/**
 * Every branch is a named, documented threshold — an LLM never
 * assigns this state directly (docs/M8_ARCHITECTURE_PROPOSAL.md §19:
 * "state transitions must be explainable").
 */
export function deriveBusinessHealth(dimensions: BusinessHealthDimensions): BusinessHealthResult {
  assertUnitInterval(dimensions);

  const rawScore =
    HEALTH_WEIGHTS.productHealth * dimensions.productHealth +
    HEALTH_WEIGHTS.customerHealth * dimensions.customerHealth +
    HEALTH_WEIGHTS.revenueHealth * dimensions.revenueHealth +
    HEALTH_WEIGHTS.growthHealth * dimensions.growthHealth +
    HEALTH_WEIGHTS.marginHealth * dimensions.marginHealth +
    HEALTH_WEIGHTS.operationalHealth * dimensions.operationalHealth;
  const compositeScore = clamp01(rawScore * (1 - dimensions.risk * 0.3));

  const reasons: string[] = [`composite score ${compositeScore.toFixed(2)} (risk-adjusted from raw ${rawScore.toFixed(2)})`];

  if (dimensions.evidenceConfidence < EARLY_EVIDENCE_THRESHOLD) {
    reasons.push(`evidence confidence ${dimensions.evidenceConfidence.toFixed(2)} is below ${EARLY_EVIDENCE_THRESHOLD} — too little track record for any other state to be trustworthy`);
    return { dimensions, compositeScore, state: "EARLY", reasons };
  }

  if (compositeScore >= HEALTHY_SCORE_THRESHOLD && dimensions.risk < HEALTHY_MAX_RISK) {
    reasons.push(`score >= ${HEALTHY_SCORE_THRESHOLD} and risk ${dimensions.risk.toFixed(2)} < ${HEALTHY_MAX_RISK}`);
    return { dimensions, compositeScore, state: "HEALTHY", reasons };
  }

  if (compositeScore < CRITICAL_SCORE_CEILING && dimensions.risk >= CRITICAL_MIN_RISK) {
    reasons.push(`score < ${CRITICAL_SCORE_CEILING} and risk ${dimensions.risk.toFixed(2)} >= ${CRITICAL_MIN_RISK}`);
    return { dimensions, compositeScore, state: "CRITICAL", reasons };
  }

  if (compositeScore >= PROMISING_SCORE_THRESHOLD) {
    reasons.push(`score >= ${PROMISING_SCORE_THRESHOLD}, below the HEALTHY bar`);
    return { dimensions, compositeScore, state: "PROMISING", reasons };
  }

  if (dimensions.growthHealth < STAGNATING_GROWTH_CEILING) {
    reasons.push(`growth health ${dimensions.growthHealth.toFixed(2)} is below ${STAGNATING_GROWTH_CEILING} while other dimensions are not yet critical`);
    return { dimensions, compositeScore, state: "STAGNATING", reasons };
  }

  reasons.push(`score ${compositeScore.toFixed(2)} is below ${PROMISING_SCORE_THRESHOLD} without qualifying as STAGNATING or CRITICAL`);
  return { dimensions, compositeScore, state: "DECLINING", reasons };
}

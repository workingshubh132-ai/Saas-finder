import { ValidationError } from "../domain/shared/errors.js";

/**
 * A THIRD, independent axis alongside opportunity score and confidence
 * — never conflated with either (Constitution §12; M3 brief Part
 * 21-22; docs/M3_ARCHITECTURE_PROPOSAL.md §11). Every dimension is
 * 0..1 and, unlike OpportunityScoreDimensions, HIGHER MEANS MORE RISK
 * — the opposite polarity, deliberately, so a reader is never left to
 * guess which direction is bad.
 */
export interface KillRiskDimensions {
  weakDemand: number;
  weakWillingnessToPay: number;
  crowdedMarket: number;
  poorDifferentiation: number;
  badDistribution: number;
  technicalDifficulty: number;
  regulatoryRisk: number;
  platformDependency: number;
  lowRetention: number;
  lowMargins: number;
  insufficientEvidence: number;
}

export interface KillRiskScoreResult {
  killRiskScore: number;
  killRiskReasons: string[];
}

export interface KillRiskScorer {
  score(dimensions: KillRiskDimensions): KillRiskScoreResult;
}

const DIMENSION_WEIGHTS: Readonly<Record<keyof KillRiskDimensions, number>> = {
  weakDemand: 0.14,
  weakWillingnessToPay: 0.14,
  crowdedMarket: 0.09,
  poorDifferentiation: 0.09,
  badDistribution: 0.1,
  technicalDifficulty: 0.08,
  regulatoryRisk: 0.08,
  platformDependency: 0.07,
  lowRetention: 0.09,
  lowMargins: 0.07,
  insufficientEvidence: 0.05,
};

/** A dimension at or above this is significant enough to name as an
 *  explicit reason (M3 brief Part 21: "explain why the kill risk is high"). */
const HIGH_RISK_THRESHOLD = 0.6;

const REASON_LABELS: Readonly<Record<keyof KillRiskDimensions, string>> = {
  weakDemand: "weak demand signal",
  weakWillingnessToPay: "weak willingness-to-pay signal",
  crowdedMarket: "crowded market with many established competitors",
  poorDifferentiation: "no meaningful differentiation identified",
  badDistribution: "no credible path to the first customers identified",
  technicalDifficulty: "high technical difficulty",
  regulatoryRisk: "meaningful regulatory risk",
  platformDependency: "dependent on a third-party platform's continued access",
  lowRetention: "low expected retention",
  lowMargins: "thin expected margins",
  insufficientEvidence: "insufficient evidence overall to assess risk confidently",
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertUnitInterval(dimensions: KillRiskDimensions): void {
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new ValidationError(`Kill-risk dimension "${key}" must be a number between 0 and 1 (got ${String(value)})`);
    }
  }
}

/**
 * Deterministic weighted average (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §11) — documented weights, not hidden. Every dimension crossing
 * HIGH_RISK_THRESHOLD becomes one explicit, named reason string; a
 * bare number alone is never returned.
 */
export class DeterministicKillRiskScorer implements KillRiskScorer {
  score(dimensions: KillRiskDimensions): KillRiskScoreResult {
    assertUnitInterval(dimensions);

    let killRiskScore = 0;
    const reasons: string[] = [];
    for (const key of Object.keys(DIMENSION_WEIGHTS) as Array<keyof KillRiskDimensions>) {
      const value = dimensions[key];
      killRiskScore += value * DIMENSION_WEIGHTS[key];
      if (value >= HIGH_RISK_THRESHOLD) {
        reasons.push(`${REASON_LABELS[key]} (${value.toFixed(2)})`);
      }
    }

    return { killRiskScore: clamp01(killRiskScore), killRiskReasons: reasons };
  }
}

import { ValidationError } from "../domain/shared/errors.js";

/**
 * The ten dimensions named in the M1 brief §12, each normalized 0..1.
 * `risk` is the odds this fails (higher = riskier); everything else is
 * "more is better".
 *
 * M3 (docs/M3_ARCHITECTURE_PROPOSAL.md §10) adds four more:
 * `marketSize`, `frequency`, `evidenceIndependence`, `timing`.
 * Deliberately NOT added: `competition` as its own attractiveness
 * dimension — Part 17's explicit reframe ("no competitors != good
 * idea") means competition isn't monotonically bad-for-score, so it
 * doesn't belong in a "higher is better" vector at all; it's kill-risk's
 * concern (kill-risk-scorer.ts), not attractiveness's.
 */
export interface OpportunityScoreDimensions {
  pain: number;
  demand: number;
  willingnessToPay: number;
  reachability: number;
  retention: number;
  differentiation: number;
  buildability: number;
  economics: number;
  risk: number;
  evidenceQuality: number;
  /** How large the addressable customer segment appears, from real signal. */
  marketSize: number;
  /** How often the pain recurs for an affected customer. */
  frequency: number;
  /** How many genuinely independent sources corroborate this — never
   *  conflated with raw evidence count (M3 brief Part 13). */
  evidenceIndependence: number;
  /** Is now a good moment for this (rising demand signal, no better
   *  time already passed)? */
  timing: number;
}

export interface ScoreOpportunityInput {
  dimensions: OpportunityScoreDimensions;
  scoredBy: string;
}

export interface ScoreOpportunityResult {
  opportunityScore: number;
  confidenceScore: number;
}

/** Architecture point, not a policy: callers depend on this interface,
 *  never on a concrete implementation. */
export interface OpportunityScorer {
  score(input: ScoreOpportunityInput): ScoreOpportunityResult;
}

const ATTRACTIVENESS_KEYS = [
  "pain",
  "demand",
  "willingnessToPay",
  "reachability",
  "retention",
  "differentiation",
  "buildability",
  "economics",
  "marketSize",
  "frequency",
  "timing",
] as const satisfies ReadonlyArray<keyof OpportunityScoreDimensions>;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertUnitInterval(dimensions: OpportunityScoreDimensions): void {
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new ValidationError(`Dimension "${key}" must be a number between 0 and 1 (got ${String(value)})`);
    }
  }
}

/**
 * Deterministic M1 placeholder (brief §12 explicitly allows this): the
 * opportunity score is the mean of the eleven attractiveness
 * dimensions, discounted by risk. VentureForge's real scoring policy —
 * Bull/Bear analysts, adversarial evaluation (Constitution §13) — is
 * out of M1/M3 scope. Swapping this for a smarter scorer later never
 * touches a caller, because every caller depends on OpportunityScorer,
 * not DeterministicOpportunityScorer.
 *
 * M3 (docs/M3_ARCHITECTURE_PROPOSAL.md §10): confidence is now the
 * average of `evidenceQuality` and `evidenceIndependence` — both
 * describe how much the assessment itself can be trusted, not how
 * attractive the opportunity is, so neither belongs in the
 * attractiveness mean (Constitution §12's own score/confidence split).
 */
export class DeterministicOpportunityScorer implements OpportunityScorer {
  score(input: ScoreOpportunityInput): ScoreOpportunityResult {
    assertUnitInterval(input.dimensions);
    const d = input.dimensions;

    const attractiveness = ATTRACTIVENESS_KEYS.reduce((sum, key) => sum + d[key], 0) / ATTRACTIVENESS_KEYS.length;
    const opportunityScore = clamp01(attractiveness * (1 - d.risk * 0.5));
    const confidenceScore = clamp01((d.evidenceQuality + d.evidenceIndependence) / 2);

    return { opportunityScore, confidenceScore };
  }
}

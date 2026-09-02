import { INDEPENDENCE_CREDIT } from "./evidence-quality.js";
import type { IndependenceLevel } from "./independence.js";
import type { ClaimValidationStatus } from "./claim-validation.types.js";

/**
 * Documented, deterministic, clamped confidence recalculation
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §11) — never `confidence += 10`.
 * Two independently inspectable steps: evidence strength, then
 * combined with the validation status and a contradiction penalty.
 */

const WEIGHT_RELIABILITY = 0.3;
const WEIGHT_SPECIFICITY = 0.2;
const WEIGHT_RECENCY = 0.15;
const WEIGHT_INDEPENDENCE = 0.15;
const WEIGHT_CORROBORATION = 0.2;

const CORROBORATION_COUNT_CAP = 3;
const CONTRADICTION_COUNT_CAP = 3;
const CONTRADICTION_PENALTY_WEIGHT = 0.2;

/**
 * INSUFFICIENT_EVIDENCE and UNVERIFIED never move confidence on their
 * own — a validation pass that found nothing must not be able to
 * accidentally raise or lower confidence through an averaging
 * side-effect (§11, §14: "honest failure is success" applied to a
 * number, not just a decision).
 */
const STATUS_TARGET: Readonly<Record<ClaimValidationStatus, number | null>> = {
  SUPPORTED: 0.9,
  WEAK: 0.4,
  CONTRADICTED: 0.1,
  CONFLICTED: 0.5,
  INSUFFICIENT_EVIDENCE: null,
  UNVERIFIED: null,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ConfidenceRecalculationInput {
  /** The Claim's current confidence, carried forward unchanged when the status has no STATUS_TARGET. */
  priorConfidence: number;
  status: ClaimValidationStatus;
  /** Averaged across supporting evidence — from the ValidationReport's own qualityAssessment (§8), not recomputed here. */
  reliability: number;
  specificity: number;
  recency: number;
  independenceLevel: IndependenceLevel;
  supportingCount: number;
  contradictingCount: number;
}

/**
 * A purely deterministic, count-based corroboration credit —
 * deliberately distinct from `EvidenceQualityAssessment.corroboration`
 * (the Validator's own *qualitative* judgment of how much the count is
 * worth, used in the separate quality-score aggregate, §8). The actual
 * confidence NUMBER is never driven solely by the model's
 * self-assessment of its own corroboration judgment — it is anchored
 * to a hard, recomputable count instead (§11, §29).
 */
function corroborationCredit(supportingCount: number): number {
  return Math.min(supportingCount, CORROBORATION_COUNT_CAP) / CORROBORATION_COUNT_CAP;
}

function contradictionPenalty(contradictingCount: number): number {
  return CONTRADICTION_PENALTY_WEIGHT * (Math.min(contradictingCount, CONTRADICTION_COUNT_CAP) / CONTRADICTION_COUNT_CAP);
}

export function recalculateClaimConfidence(input: ConfidenceRecalculationInput): number {
  const target = STATUS_TARGET[input.status];
  if (target === null) return input.priorConfidence;

  const evidenceStrength = clamp01(
    WEIGHT_RELIABILITY * input.reliability +
      WEIGHT_SPECIFICITY * input.specificity +
      WEIGHT_RECENCY * input.recency +
      WEIGHT_INDEPENDENCE * INDEPENDENCE_CREDIT[input.independenceLevel] +
      WEIGHT_CORROBORATION * corroborationCredit(input.supportingCount),
  );

  // Applied even when status = SUPPORTED (§6 guarantee #2, §11): a
  // claim can never silently round up to full confidence while a
  // credible contradiction sits unaddressed in its own evidence trail.
  return clamp01(target * (0.5 + 0.5 * evidenceStrength) - contradictionPenalty(input.contradictingCount));
}

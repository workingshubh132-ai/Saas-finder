import { CLAIM_IMPORTANCE_WEIGHT, type ClaimImportance } from "./claim.types.js";
import type { ClaimValidationStatus } from "./claim-validation.types.js";

/**
 * Expected Information Gain (docs/M4_ARCHITECTURE_PROPOSAL.md §15) —
 * extends, does not replace, `evidence-gap.service.ts`'s existing
 * extremity-based `computeImpactScore`. Used only when an `EvidenceGap`
 * is linked to a specific `Claim` (`EvidenceGap.claimId`); dimension-level
 * gaps with no claim behind them keep using the original M3 formula.
 */
const WEIGHT_IMPORTANCE = 0.5;
const WEIGHT_UNCERTAINTY = 0.3;
const WEIGHT_RESEARCH_COST = 0.2;

/**
 * How "open" the question still is. A confidently CONTRADICTED claim
 * is lower research value than a genuine UNVERIFIED unknown (we
 * already have a reasonably confident answer) — though a KILL grounded
 * in one CONTRADICTED CRITICAL claim may still warrant a confirming
 * second look; that judgment call belongs to the CEO (HUMAN_REVIEW,
 * §13), not this formula.
 */
const UNCERTAINTY_FACTOR: Readonly<Record<ClaimValidationStatus, number>> = {
  UNVERIFIED: 1.0,
  INSUFFICIENT_EVIDENCE: 1.0,
  WEAK: 0.7,
  CONFLICTED: 0.7,
  SUPPORTED: 0.3,
  CONTRADICTED: 0.3,
};

export interface ClaimEigInput {
  readonly importance: ClaimImportance;
  readonly status: ClaimValidationStatus;
  /** 0..1 placeholder, same documented gap as `estimatedResearchCost` in `domain/research-queue/priority.ts` — no real per-item cost model exists yet (docs/DECISIONS.md). */
  readonly normalizedResearchCost: number;
}

/**
 * Deliberately unbounded / can go negative, same polarity reasoning as
 * `computeQueuePriority` — a LOW-importance, already-SUPPORTED,
 * expensive-to-research claim should sort to the bottom, not get
 * floored to an uninformative 0.
 */
export function computeExpectedInformationGain(input: ClaimEigInput): number {
  return (
    WEIGHT_IMPORTANCE * CLAIM_IMPORTANCE_WEIGHT[input.importance] +
    WEIGHT_UNCERTAINTY * UNCERTAINTY_FACTOR[input.status] -
    WEIGHT_RESEARCH_COST * input.normalizedResearchCost
  );
}

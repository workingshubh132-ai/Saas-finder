import { CLAIM_IMPORTANCE_WEIGHT, type ClaimImportance } from "./claim.types.js";

/**
 * Opportunity-level confidence, recomputed as claim confidences change
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §11) — a weighted average by claim
 * importance (§3's CRITICAL/HIGH/MEDIUM/LOW table), so a single
 * CRITICAL claim collapsing moves opportunity confidence far more than
 * any number of LOW claims doing the same.
 */
export interface ClaimConfidenceInput {
  importance: ClaimImportance;
  confidence: number;
}

/** Null when no claims exist yet — never fabricates a confidence figure from nothing. */
export function computeAggregateConfidence(claims: readonly ClaimConfidenceInput[]): number | null {
  if (claims.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const claim of claims) {
    const weight = CLAIM_IMPORTANCE_WEIGHT[claim.importance];
    weightedSum += claim.confidence * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

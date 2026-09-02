/**
 * `ClaimEvidence` relationship kind (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §4) — a genuine relation between one Evidence item and one Claim,
 * not metadata on either side. `UNKNOWN` is a real, storable value:
 * evidence whose bearing on a specific claim the Evidence Validator
 * could not confidently classify either way is recorded as such rather
 * than silently omitted — an ambiguous read is itself information.
 */
export const CLAIM_EVIDENCE_RELATIONSHIPS = ["SUPPORTING", "CONTRADICTING", "UNKNOWN"] as const;
export type ClaimEvidenceRelationship = (typeof CLAIM_EVIDENCE_RELATIONSHIPS)[number];

export function isClaimEvidenceRelationship(value: string): value is ClaimEvidenceRelationship {
  return (CLAIM_EVIDENCE_RELATIONSHIPS as readonly string[]).includes(value);
}

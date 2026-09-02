/**
 * Prospect qualification outcome (docs/M5_ARCHITECTURE_PROPOSAL.md §5,
 * brief §7) — distinct from `PROSPECT_STATUSES` (prospect.types.ts):
 * `status` tracks pipeline position, `qualificationStatus` is
 * `prospectQualificationService`'s own assessment of ICP fit, set once
 * and always read alongside `icpFit`/`reasonForMatch`/`unknowns` so a
 * human or the CEO never sees a bare score ("Not a bare score" — brief
 * §7).
 */
export const PROSPECT_QUALIFICATION_STATUSES = ["QUALIFIED", "REJECTED", "UNQUALIFIED"] as const;
export type ProspectQualificationStatus = (typeof PROSPECT_QUALIFICATION_STATUSES)[number];

export function isProspectQualificationStatus(value: string): value is ProspectQualificationStatus {
  return (PROSPECT_QUALIFICATION_STATUSES as readonly string[]).includes(value);
}

/** HIGH|MEDIUM|LOW — reuses the same three-level vocabulary EvidenceReliability/CustomerEvidenceStrength already established, not a new scale. */
export const ICP_FIT_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type IcpFitLevel = (typeof ICP_FIT_LEVELS)[number];

export function isIcpFitLevel(value: string): value is IcpFitLevel {
  return (ICP_FIT_LEVELS as readonly string[]).includes(value);
}

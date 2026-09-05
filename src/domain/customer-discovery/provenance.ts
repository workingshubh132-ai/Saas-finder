/**
 * Discovery-finding provenance — a third axis, distinct from both
 * `RealityLabel` (src/domain/real-world/reality.types.ts, "did this
 * action touch the real world") and `CustomerEvidenceDirectness`
 * (src/domain/customer-evidence/customer-signal.types.ts, DIRECT vs
 * INFERRED — grades one already-extracted claim's interpretive
 * distance). This one grades whether a specific structured finding was
 * ever actually established at all. UNKNOWN is a first-class value,
 * never silently collapsed into a negative answer or omitted.
 */
export const FINDING_PROVENANCES = ["OBSERVED", "INFERRED", "UNKNOWN"] as const;
export type FindingProvenance = (typeof FINDING_PROVENANCES)[number];

export function isFindingProvenance(value: string): value is FindingProvenance {
  return (FINDING_PROVENANCES as readonly string[]).includes(value);
}

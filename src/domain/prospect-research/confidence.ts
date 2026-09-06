/**
 * Never trust the model's own confidence claim directly (the same
 * discipline problemAnalystService applies to evidenceCount) — a
 * candidate backed by zero OBSERVED workflow/pain signals is capped at
 * a modest ceiling regardless of what the model itself reports,
 * because "confident" and "entirely inferred" cannot both be true.
 */
const MAX_CONFIDENCE_WITHOUT_OBSERVED_SIGNAL = 0.4;
const MAX_CONFIDENCE = 0.9;

export interface ProvenanceTaggedItem {
  readonly provenance: string;
}

export function capProspectCandidateConfidence(rawConfidence: number, items: readonly ProvenanceTaggedItem[]): number {
  const clamped = Math.max(0, Math.min(MAX_CONFIDENCE, rawConfidence));
  const hasObserved = items.some((item) => item.provenance === "OBSERVED");
  return hasObserved ? clamped : Math.min(clamped, MAX_CONFIDENCE_WITHOUT_OBSERVED_SIGNAL);
}

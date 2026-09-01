import type { TransitionTable } from "../shared/state-machine.js";

/**
 * M3 brief Part 31. `dimension` is intentionally a free label, not a
 * closed enum over OpportunityScoreDimensions/KillRiskDimensions keys
 * — the set of things that can be uncertain about an opportunity is
 * open-ended (e.g. "does this even reach existing customers" spans
 * more than one scoring dimension). What IS closed is the gap's own
 * status, so "is this resolved yet" is always answerable without
 * reading free text.
 */
export const EVIDENCE_GAP_STATUSES = ["UNKNOWN", "ASSUMPTION", "KNOWN", "RESOLVED"] as const;
export type EvidenceGapStatus = (typeof EVIDENCE_GAP_STATUSES)[number];

export function isEvidenceGapStatus(value: string): value is EvidenceGapStatus {
  return (EVIDENCE_GAP_STATUSES as readonly string[]).includes(value);
}

/**
 * UNKNOWN (nothing gathered yet) and ASSUMPTION (an agent had to
 * assume a value) both resolve toward KNOWN (real evidence now covers
 * it) or directly to RESOLVED (the gap no longer matters — e.g. the
 * opportunity was rejected for other reasons first). RESOLVED is
 * terminal for that specific gap record; a later re-analysis creates
 * a fresh EvidenceGap row rather than reopening an old one, keeping
 * each row's history honest about when it was actually resolved.
 */
export const EVIDENCE_GAP_STATUS_TRANSITIONS: TransitionTable<EvidenceGapStatus> = {
  UNKNOWN: ["ASSUMPTION", "KNOWN", "RESOLVED"],
  ASSUMPTION: ["KNOWN", "RESOLVED"],
  KNOWN: ["RESOLVED"],
  RESOLVED: [],
};

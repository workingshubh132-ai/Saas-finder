import type { EvidenceReliability } from "./evidence.types.js";

/**
 * Baseline reliability per registered research source id
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §12) — the same "small, explicit,
 * founder-revisable policy table" pattern as
 * domain/risk/permission-risk-policy.ts. This is the reliability a
 * signal from that source seeds onto the Evidence row created from it
 * (evidenceService.collectEvidence is still the only thing that
 * writes Evidence — this only supplies its default `reliability`
 * input); a downstream agent may record a more specific value for one
 * particular claim if it has real grounds to, but nothing defaults
 * higher than a source's own baseline.
 */
export const SOURCE_RELIABILITY: Readonly<Record<string, EvidenceReliability>> = {
  // Public, pseudonymous, unmoderated-beyond-community-voting — real
  // signal, but never assumed HIGH without independent corroboration.
  hacker_news: "MEDIUM",
  // Same profile as Hacker News; an accepted-answer pattern gives
  // slightly more structure than a bare discussion thread, but authors
  // are still pseudonymous and unverified, so this stays MEDIUM too.
  stack_exchange: "MEDIUM",
};

/**
 * Fails closed to the *lowest* reliability tier for an unrecognized
 * source id — never assumes a new or misspelled source id deserves
 * more trust than the most conservative default (the same
 * unknown-value discipline as getPermissionRiskLevel/RiskPolicy;
 * see docs/SECURITY.md).
 */
export function getSourceReliability(sourceId: string): EvidenceReliability {
  return SOURCE_RELIABILITY[sourceId] ?? "LOW";
}

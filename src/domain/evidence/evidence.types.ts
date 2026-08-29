import type { TransitionTable } from "../shared/state-machine.js";

export const EVIDENCE_SOURCE_TYPES = [
  "WEB",
  "CUSTOMER",
  "COMPETITOR",
  "MARKET_DATA",
  "INTERNAL",
  "EXPERIMENT",
  "OTHER",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export function isEvidenceSourceType(value: string): value is EvidenceSourceType {
  return (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

/** Trustworthiness of the source itself — distinct from `confidence`,
 *  which is the collector's confidence that the specific claim is true. */
export const EVIDENCE_RELIABILITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type EvidenceReliability = (typeof EVIDENCE_RELIABILITIES)[number];

export function isEvidenceReliability(value: string): value is EvidenceReliability {
  return (EVIDENCE_RELIABILITIES as readonly string[]).includes(value);
}

export const EVIDENCE_VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PARTIALLY_VERIFIED",
  "VERIFIED",
  "DISPUTED",
  "REJECTED",
] as const;
export type EvidenceVerificationStatus = (typeof EVIDENCE_VERIFICATION_STATUSES)[number];

export function isEvidenceVerificationStatus(value: string): value is EvidenceVerificationStatus {
  return (EVIDENCE_VERIFICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * REJECTED is terminal; everything else can move toward stronger or
 * weaker verification as new information arrives (e.g. VERIFIED ->
 * DISPUTED if a later claim contradicts it).
 */
export const EVIDENCE_VERIFICATION_TRANSITIONS: TransitionTable<EvidenceVerificationStatus> = {
  UNVERIFIED: ["PARTIALLY_VERIFIED", "VERIFIED", "DISPUTED", "REJECTED"],
  PARTIALLY_VERIFIED: ["VERIFIED", "DISPUTED", "REJECTED"],
  DISPUTED: ["PARTIALLY_VERIFIED", "VERIFIED", "REJECTED"],
  VERIFIED: ["DISPUTED"],
  REJECTED: [],
};

import type { TransitionTable } from "../shared/state-machine.js";

/**
 * M3 brief Part 4: the raw, low-commitment record of "something a
 * source returned" — cheap and unverified, distinct from Evidence
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §2).
 */
export const SIGNAL_STATUSES = ["NEW", "PROCESSED", "DUPLICATE", "REJECTED", "CLUSTERED", "ARCHIVED"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export function isSignalStatus(value: string): value is SignalStatus {
  return (SIGNAL_STATUSES as readonly string[]).includes(value);
}

/**
 * NEW -> PROCESSED (passed normalization/basic sanity) or DUPLICATE
 * (§5) or REJECTED (unusable content). PROCESSED -> CLUSTERED once
 * signalClusteringService assigns it (§6). ARCHIVED is reachable from
 * every non-terminal state, matching the Opportunity/Task precedent
 * (docs/DECISIONS.md #7).
 */
export const SIGNAL_STATUS_TRANSITIONS: TransitionTable<SignalStatus> = {
  NEW: ["PROCESSED", "DUPLICATE", "REJECTED", "ARCHIVED"],
  PROCESSED: ["CLUSTERED", "ARCHIVED"],
  DUPLICATE: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  CLUSTERED: ["ARCHIVED"],
  ARCHIVED: [],
};

/**
 * Deliberately the SAME vocabulary as Evidence.sourceType
 * (domain/evidence/evidence.types.ts) rather than a parallel one — a
 * signal promoted to Evidence (§8) carries its sourceType across with
 * no translation step to get wrong. Every current source adapter
 * reports "WEB" (a public web/community/forum post); CUSTOMER,
 * COMPETITOR, MARKET_DATA, INTERNAL, and EXPERIMENT stay reachable for
 * source kinds no current adapter produces but a future one might
 * (e.g. a direct customer-interview import), rather than needing a
 * second enum reconciled with this one later.
 */
export { EVIDENCE_SOURCE_TYPES as SIGNAL_SOURCE_TYPES, isEvidenceSourceType as isSignalSourceType } from "../evidence/evidence.types.js";
export type { EvidenceSourceType as SignalSourceType } from "../evidence/evidence.types.js";

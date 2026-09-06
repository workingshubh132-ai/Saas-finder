/**
 * Evidence-backed prospect-targeting signals (Part 46: closing the gap
 * where icpAnalystService's deterministic path only ever mapped
 * CUSTOMER_SEGMENT/CUSTOMER_PROBLEM/FREQUENCY into ICP fields, leaving
 * real technology/workflow signal already sitting in an opportunity's
 * own Evidence text — e.g. a named platform, a described workflow —
 * uncaptured). A separate, additive axis from `IcpFieldGrounding`
 * (icp-field-grounding.ts): that schema grounds the 8 original ICP
 * fields in CLAIMS; this one grounds arbitrary targeting signals
 * directly in EVIDENCE, since claim statements in dev-fixture mode are
 * boilerplate and never carry the specific vocabulary real evidence
 * text does.
 */
export const TARGETING_SIGNAL_CATEGORIES = ["PLATFORM", "WORKFLOW", "OPERATIONAL"] as const;
export type TargetingSignalCategory = (typeof TARGETING_SIGNAL_CATEGORIES)[number];

export function isTargetingSignalCategory(value: string): value is TargetingSignalCategory {
  return (TARGETING_SIGNAL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Four states, deliberately distinct from IcpFieldGrounding's own
 * EVIDENCED|ASSUMED: EVIDENCED = the exact phrase is directly present
 * in real evidence text; INFERRED = a broader generalization derived
 * FROM an EVIDENCED signal, never itself directly stated (Design
 * Requirement B — a single named platform must never silently become
 * a universal category requirement); ASSUMED = same meaning as
 * elsewhere in this codebase (no evidence either way, conservative
 * default); UNKNOWN = an explicit, honest statement that something
 * specific remains unresolved (e.g. whether an INFERRED generalization
 * actually holds beyond the one platform it was generalized from) —
 * never silently omitted.
 */
export const TARGETING_SIGNAL_PROVENANCES = ["EVIDENCED", "INFERRED", "ASSUMED", "UNKNOWN"] as const;
export type TargetingSignalProvenance = (typeof TARGETING_SIGNAL_PROVENANCES)[number];

export function isTargetingSignalProvenance(value: string): value is TargetingSignalProvenance {
  return (TARGETING_SIGNAL_PROVENANCES as readonly string[]).includes(value);
}

export interface EvidenceTargetingSignal {
  readonly category: TargetingSignalCategory;
  /** Human-readable, e.g. "Xero", "Accounting/bookkeeping software with automated payment matching". */
  readonly label: string;
  readonly provenance: TargetingSignalProvenance;
  /** Real Evidence row ids this signal was matched against — empty for ASSUMED/UNKNOWN entries, which by definition cite no direct evidence. */
  readonly groundedEvidenceIds: string[];
  /** Real Claim row ids, when a signal is instead (or additionally) grounded in an already-extracted claim rather than raw evidence text. */
  readonly groundedClaimIds: string[];
  readonly reasoning: string;
  /** The short, lowercase phrase(s) that produced this signal — reused verbatim by prospectQualificationService so a real prospect's own text is matched against the same terms that grounded the signal, not a second, independently-drifting vocabulary. */
  readonly matchTerms: string[];
  /** True for signals describing WHAT TECHNOLOGY a business uses (a named platform or its generalized category) — the candidates icpAnalystService considers for the ICP's own `technology` field. False for workflow/operational signals (e.g. "receives bank payments") that describe the business's activity, not its tooling. */
  readonly isTechnologyRelevant: boolean;
}

/**
 * The Human Decision Queue (docs/M9_ARCHITECTURE_PROPOSAL.md §19, M9
 * brief §7) — reuses, aggregates, creates nothing new that decides.
 * Every entry is normalized from one of two REAL, already-existing
 * sources: a PENDING/DEFERRED ApprovalRequest, or one of the five memo
 * tables with humanDecision IS NULL. The union happens in application
 * code at read time; this file only defines the common shape and the
 * table of which memo tables exist (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §10 — the five memo tables stay five separate Prisma models,
 * deliberately not unified).
 */
/**
 * COMPANY_RECOMMENDATION is a third source, distinct from MEMO
 * (docs/DECISIONS.md's own M9 entry on CompanyRecommendation): every
 * one of the five MEMO tables references a shared CeoRecommendation/
 * ChairmanReview row via a required, opportunity-scoped FK — a
 * structural assumption company-level recommendations (which may
 * target zero, one, or conceptually the whole portfolio) don't fit.
 * CompanyRecommendation carries its own decision fields directly
 * rather than forcing a required opportunityId onto a genuinely
 * cross-cutting row.
 */
/**
 * ALERT (Autonomous Operations Phase A, docs/AUTONOMOUS_OPERATIONS_AUDIT.md)
 * is a fourth source, following the exact COMPANY_RECOMMENDATION
 * precedent above it: `alertService.raise()` already computes its own
 * `computeFounderAttentionScore` at raise time, but had never actually
 * reached the founder's own queue — this closes that real gap by
 * unioning it here rather than building a second surface for it.
 */
export const DECISION_QUEUE_SOURCE_KINDS = ["APPROVAL_REQUEST", "MEMO", "COMPANY_RECOMMENDATION", "ALERT"] as const;
export type DecisionQueueSourceKind = (typeof DECISION_QUEUE_SOURCE_KINDS)[number];

/**
 * The five existing "CEO recommends -> Chairman reviews -> human
 * decides" memo tables (docs/M9_ARCHITECTURE_PROPOSAL.md §10) — every
 * entry here is a real Prisma model already shipped in M4-M8; this
 * table exists so decisionQueueService can query all five uniformly
 * without a sixth, unifying table.
 */
export const MEMO_QUEUE_SOURCES = [
  "INVESTMENT_MEMO",
  "CUSTOMER_DISCOVERY_MEMO",
  "PRODUCT_REVIEW_MEMO",
  "LAUNCH_REVIEW_MEMO",
  "BUSINESS_REVIEW_MEMO",
] as const;
export type MemoQueueSource = (typeof MEMO_QUEUE_SOURCES)[number];

export function isMemoQueueSource(value: string): value is MemoQueueSource {
  return (MEMO_QUEUE_SOURCES as readonly string[]).includes(value);
}

/** The one common shape every queue entry is normalized to before scoring (docs/M9_ARCHITECTURE_PROPOSAL.md §18-19). */
export interface DecisionQueueEntry {
  readonly sourceKind: DecisionQueueSourceKind;
  readonly source: MemoQueueSource | "APPROVAL_REQUEST" | "COMPANY_RECOMMENDATION" | "ALERT";
  readonly id: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly summary: string;
  readonly riskLevel: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

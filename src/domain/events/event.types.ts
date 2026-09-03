/** Domain events (Constitution §14 of the M1 brief) — the minimum set
 *  named there. Extending this list is expected but out of M1 scope
 *  beyond what the vertical slice actually emits. */
export const DOMAIN_EVENT_TYPES = [
  "AGENT_CREATED",
  "AGENT_SUSPENDED",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "EVIDENCE_ADDED",
  "OPPORTUNITY_DISCOVERED",
  "OPPORTUNITY_SCORED",
  "OPPORTUNITY_UPDATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  // M3 — docs/M3_ARCHITECTURE_PROPOSAL.md §16, §22.
  "SIGNAL_CLUSTER_CREATED",
  "PROBLEM_EXTRACTED",
  "COMPETITOR_ANALYSIS_COMPLETED",
  "RESEARCH_CYCLE_STARTED",
  "RESEARCH_CYCLE_COMPLETED",
  /** Reserved in M3, first actually fired in M4 — by
   *  `decisionRecordService.applyHumanDecision` directly (a single
   *  call site, not a registered event-bus subscriber; see
   *  docs/M4_ARCHITECTURE_PROPOSAL.md §20, §29 for why the pub/sub
   *  indirection the M3 doc comment originally envisioned was judged
   *  unnecessary), so a future learning process reads one
   *  self-contained snapshot (decision + score + confidence + kill
   *  risk + Chairman decision + CEO action + accepted/rejected claims)
   *  instead of joining four tables (M3 brief Part 32/33; M4 brief
   *  Part 38; docs/M4_ARCHITECTURE_PROPOSAL.md §27). */
  "OPPORTUNITY_DECISION_RECORDED",
  // M4 — docs/M4_ARCHITECTURE_PROPOSAL.md §27.
  "CLAIM_EXTRACTED",
  "CLAIM_VALIDATED",
  "CEO_RECOMMENDATION_ISSUED",
  "INVESTMENT_MEMO_CREATED",
  "OPPORTUNITY_KILLED",
  "DECISION_CYCLE_STARTED",
  "DECISION_CYCLE_COMPLETED",
  // M5 — docs/M5_ARCHITECTURE_PROPOSAL.md §28.
  "PROSPECT_DISCOVERED",
  "OUTREACH_EXPERIMENT_APPROVED",
  "OUTREACH_MESSAGE_DRAFTED",
  "OUTREACH_MESSAGE_CONTACTED",
  "CUSTOMER_RESPONSE_RECORDED",
  "CUSTOMER_EVIDENCE_CREATED",
  "CUSTOMER_DISCOVERY_MEMO_CREATED",
  // M6 — docs/M6_ARCHITECTURE_PROPOSAL.md §2.
  "PRODUCT_APPROVED",
  "PRODUCT_SPEC_CREATED",
  "MVP_ARCHITECTURE_CREATED",
  "ENGINEERING_TASK_COMPLETED",
  "SECURITY_REVIEW_COMPLETED",
  "PRODUCT_REVIEW_MEMO_CREATED",
  "PRODUCT_READY_FOR_DEPLOYMENT",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

export interface DomainEventInput {
  readonly type: DomainEventType;
  /** Enough information to reconstruct what happened without a join. */
  readonly payload: Record<string, unknown>;
}

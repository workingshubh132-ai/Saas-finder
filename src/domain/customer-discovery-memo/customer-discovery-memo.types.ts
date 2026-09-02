/**
 * The Human Owner's decision on a CustomerDiscoveryMemo (brief §30) — a
 * richer vocabulary than ApprovalRequest's own APPROVED/REJECTED
 * because a customer-discovery decision routinely isn't binary
 * (MORE_RESEARCH/REFINE_ICP are real, common outcomes, not an
 * afterthought). Stored directly on CustomerDiscoveryMemo
 * (humanDecision/humanReason/decidedAt/decidedByIdentityId), filled in
 * by exactly one later update — the same "starts undecided, completed
 * by a single human action" shape ApprovalRequest itself already uses
 * (status/reviewedBy/reviewedAt/decisionReason), not a second
 * DecisionRecord-style table: DecisionRecord exists to decouple a
 * decision from a resource mutation it gates (KILL vs
 * Opportunity.status), and there is no such mutation here for this
 * decision to be decoupled from.
 */
export const CUSTOMER_DISCOVERY_HUMAN_DECISIONS = ["APPROVE", "REJECT", "MORE_RESEARCH", "REFINE_ICP", "STOP"] as const;
export type CustomerDiscoveryHumanDecision = (typeof CUSTOMER_DISCOVERY_HUMAN_DECISIONS)[number];

export function isCustomerDiscoveryHumanDecision(value: string): value is CustomerDiscoveryHumanDecision {
  return (CUSTOMER_DISCOVERY_HUMAN_DECISIONS as readonly string[]).includes(value);
}

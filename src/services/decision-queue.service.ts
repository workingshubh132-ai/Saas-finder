import type { ApprovalRequest, Evidence, Opportunity } from "@prisma/client";
import { evidenceRepository } from "../db/repositories/evidence.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { fromJsonString } from "../domain/shared/json.js";
import { approvalService } from "./approval.service.js";

export interface DecisionQueueEntry {
  approvalRequest: ApprovalRequest;
  /** Evidence backing the request — "why does VentureForge believe this?" (Constitution §11). */
  evidence: Evidence[];
  /** Populated when the request is about an Opportunity, for the opportunity_score / confidence_score context. */
  linkedOpportunity: Opportunity | null;
}

async function enrich(approvalRequest: ApprovalRequest): Promise<DecisionQueueEntry> {
  const evidenceIds = fromJsonString<string[]>(approvalRequest.evidence, []);
  const [evidence, linkedOpportunity] = await Promise.all([
    evidenceIds.length > 0 ? evidenceRepository.findManyByIds(evidenceIds) : Promise.resolve([]),
    approvalRequest.resourceType === "OPPORTUNITY" && approvalRequest.resourceId
      ? opportunityRepository.findById(approvalRequest.resourceId)
      : Promise.resolve(null),
  ]);
  return { approvalRequest, evidence, linkedOpportunity };
}

/**
 * The Human Decision Queue (Constitution §28): a read model over
 * pending ApprovalRequests, enriched with enough context — evidence,
 * the opportunity's current score — for the Human Owner to decide
 * without leaving the queue. Deciding itself still goes through
 * approvalService so the self-approval guard and audit trail apply.
 */
export const decisionQueueService = {
  async listQueue(): Promise<DecisionQueueEntry[]> {
    const queue = await approvalService.listQueue();
    return Promise.all(queue.map(enrich));
  },

  async getDecision(id: string): Promise<DecisionQueueEntry> {
    const approvalRequest = await approvalService.getOrThrow(id);
    return enrich(approvalRequest);
  },
};

import type { ApprovalRequest, ChairmanReview, Evidence, Opportunity } from "@prisma/client";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
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
  /**
   * The Chairman's latest recommendation for the linked opportunity, if
   * one exists — CEO/agent recommendation, Chairman recommendation,
   * Guardian status (the request existing at all implies Guardian
   * cleared it), and the pending Human decision, together in one place
   * (Constitution §17/§28).
   */
  chairmanReview: ChairmanReview | null;
}

async function enrich(approvalRequest: ApprovalRequest): Promise<DecisionQueueEntry> {
  const evidenceIds = fromJsonString<string[]>(approvalRequest.evidence, []);
  const isOpportunityRequest = approvalRequest.resourceType === "OPPORTUNITY" && Boolean(approvalRequest.resourceId);

  const [evidence, linkedOpportunity, chairmanReview] = await Promise.all([
    evidenceIds.length > 0 ? evidenceRepository.findManyByIds(evidenceIds) : Promise.resolve([]),
    isOpportunityRequest ? opportunityRepository.findById(approvalRequest.resourceId as string) : Promise.resolve(null),
    isOpportunityRequest ? chairmanReviewRepository.findLatestForOpportunity(approvalRequest.resourceId as string) : Promise.resolve(null),
  ]);

  return { approvalRequest, evidence, linkedOpportunity, chairmanReview };
}

/**
 * The Human Decision Queue (Constitution §28): a read model over
 * pending ApprovalRequests, enriched with enough context — evidence,
 * the opportunity's current score, the Chairman's review — for the
 * Human Owner to decide without leaving the queue. Deciding itself
 * still goes through approvalService so the self-approval guard and
 * audit trail apply; the Chairman never decides on the Human's behalf.
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

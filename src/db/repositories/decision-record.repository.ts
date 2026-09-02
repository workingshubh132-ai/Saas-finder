import type { DecisionRecord } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateDecisionRecordInput {
  opportunityId: string;
  approvalRequestId: string;
  investmentMemoId: string | null;
  ceoRecommendationId: string | null;
  chairmanReviewId: string | null;
  humanDecision: string;
  humanReason: string | null;
  opportunityScoreAtDecision: number | null;
  confidenceAtDecision: number | null;
  killRiskAtDecision: number | null;
  rejectedClaimIds: string;
  acceptedClaimIds: string;
  missingEvidenceNoted: string;
}

/** Append-only (docs/M4_ARCHITECTURE_PROPOSAL.md §20, §27) — no update method exposed; never overwrites historical truth. */
export const decisionRecordRepository = {
  create(input: CreateDecisionRecordInput): Promise<DecisionRecord> {
    return prisma.decisionRecord.create({ data: input });
  },

  findById(id: string): Promise<DecisionRecord | null> {
    return prisma.decisionRecord.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<DecisionRecord[]> {
    return prisma.decisionRecord.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  findByApprovalRequestId(approvalRequestId: string): Promise<DecisionRecord | null> {
    return prisma.decisionRecord.findFirst({ where: { approvalRequestId } });
  },

  list(): Promise<DecisionRecord[]> {
    return prisma.decisionRecord.findMany({ orderBy: { createdAt: "desc" } });
  },
};

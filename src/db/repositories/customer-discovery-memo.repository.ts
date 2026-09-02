import type { CustomerDiscoveryMemo } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCustomerDiscoveryMemoInput {
  opportunityId: string;
  experimentId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  content: string;
  claimsStrengthened: string;
  claimsWeakened: string;
  independentOrganizationCount: number;
  responseCount: number;
  recommendation: string;
  confidence: number;
}

export interface RecordHumanDecisionInput {
  humanDecision: string;
  humanReason: string | null;
  decidedByIdentityId: string;
}

/** Append-only analytical content, completed by exactly one later human-decision update (docs/M5_ARCHITECTURE_PROPOSAL.md §22, mirrors ApprovalRequest's own status/reviewedBy/reviewedAt shape). */
export const customerDiscoveryMemoRepository = {
  create(input: CreateCustomerDiscoveryMemoInput): Promise<CustomerDiscoveryMemo> {
    return prisma.customerDiscoveryMemo.create({ data: input });
  },

  findById(id: string): Promise<CustomerDiscoveryMemo | null> {
    return prisma.customerDiscoveryMemo.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<CustomerDiscoveryMemo[]> {
    return prisma.customerDiscoveryMemo.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForExperiment(experimentId: string): Promise<CustomerDiscoveryMemo | null> {
    return prisma.customerDiscoveryMemo.findFirst({ where: { experimentId }, orderBy: { createdAt: "desc" } });
  },

  /** Every memo, across every opportunity — mirrors decisionRecordRepository.list()'s own shape, for calibrationService.summarizeCustomerDiscovery(). */
  list(): Promise<CustomerDiscoveryMemo[]> {
    return prisma.customerDiscoveryMemo.findMany({ orderBy: { createdAt: "desc" } });
  },

  recordHumanDecision(id: string, input: RecordHumanDecisionInput): Promise<CustomerDiscoveryMemo> {
    return prisma.customerDiscoveryMemo.update({ where: { id }, data: { ...input, decidedAt: new Date() } });
  },
};

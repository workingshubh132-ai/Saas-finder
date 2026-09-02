import type { CeoRecommendation } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCeoRecommendationInput {
  opportunityId: string;
  decisionCycleId?: string | null;
  action: string;
  reasoning: string;
  citedClaimIds: string;
  citedValidationReportIds: string;
  confidence: number;
  priorityScore: number;
}

/** Append-only (docs/M4_ARCHITECTURE_PROPOSAL.md §12, §27) — no update method exposed. */
export const ceoRecommendationRepository = {
  create(input: CreateCeoRecommendationInput): Promise<CeoRecommendation> {
    return prisma.ceoRecommendation.create({ data: input });
  },

  findById(id: string): Promise<CeoRecommendation | null> {
    return prisma.ceoRecommendation.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<CeoRecommendation[]> {
    return prisma.ceoRecommendation.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForOpportunity(opportunityId: string): Promise<CeoRecommendation | null> {
    return prisma.ceoRecommendation.findFirst({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },
};

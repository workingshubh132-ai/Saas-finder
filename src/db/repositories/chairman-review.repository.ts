import type { ChairmanReview } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateChairmanReviewInput {
  opportunityId: string;
  decision: string;
  reasoning: string;
  objections: string;
  missingEvidence: string;
  confidence: number;
  recommendation: string;
  modelProvider: string;
  modelName: string;
}

export const chairmanReviewRepository = {
  create(input: CreateChairmanReviewInput): Promise<ChairmanReview> {
    return prisma.chairmanReview.create({ data: input });
  },

  /** M4 — investment-memo.service.ts needs to look up a specific,
   *  already-referenced review by id, not just "the latest" (docs/M4_ARCHITECTURE_PROPOSAL.md §17). */
  findById(id: string): Promise<ChairmanReview | null> {
    return prisma.chairmanReview.findUnique({ where: { id } });
  },

  findLatestForOpportunity(opportunityId: string): Promise<ChairmanReview | null> {
    return prisma.chairmanReview.findFirst({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  listForOpportunity(opportunityId: string): Promise<ChairmanReview[]> {
    return prisma.chairmanReview.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },
};

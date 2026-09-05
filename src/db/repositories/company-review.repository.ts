import type { CompanyReview } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCompanyReviewInput {
  companyRecommendationId: string;
  decision: string;
  reasoning: string;
  objections: string;
  missingEvidence: string;
  confidence: number;
  recommendation: string;
  modelProvider: string;
  modelName: string;
}

export const companyReviewRepository = {
  create(input: CreateCompanyReviewInput): Promise<CompanyReview> {
    return prisma.companyReview.create({ data: input });
  },

  findById(id: string): Promise<CompanyReview | null> {
    return prisma.companyReview.findUnique({ where: { id } });
  },

  findLatestForRecommendation(companyRecommendationId: string): Promise<CompanyReview | null> {
    return prisma.companyReview.findFirst({ where: { companyRecommendationId }, orderBy: { createdAt: "desc" } });
  },
};

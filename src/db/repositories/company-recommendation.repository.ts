import type { CompanyRecommendation } from "@prisma/client";
import { NotFoundError } from "../../domain/shared/errors.js";
import { prisma } from "../client.js";

export interface CreateCompanyRecommendationInput {
  action: string;
  reasoning: string;
  targetOpportunityId?: string | null;
  targetProductId?: string | null;
  citedResourceIds: string;
  confidence: number;
  operatingCycleId?: string | null;
  conflictResolution?: string | null;
}

export interface RecordHumanDecisionInput {
  humanDecision: string;
  humanReason: string | null;
  decidedByIdentityId: string;
}

export const companyRecommendationRepository = {
  create(input: CreateCompanyRecommendationInput): Promise<CompanyRecommendation> {
    return prisma.companyRecommendation.create({ data: input });
  },

  findById(id: string): Promise<CompanyRecommendation | null> {
    return prisma.companyRecommendation.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<CompanyRecommendation> {
    const rec = await prisma.companyRecommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundError("CompanyRecommendation", id);
    return rec;
  },

  setConflictResolution(id: string, conflictResolution: string): Promise<CompanyRecommendation> {
    return prisma.companyRecommendation.update({ where: { id }, data: { conflictResolution } });
  },

  recordHumanDecision(id: string, input: RecordHumanDecisionInput): Promise<CompanyRecommendation> {
    return prisma.companyRecommendation.update({
      where: { id },
      data: { ...input, decidedAt: new Date() },
    });
  },

  listUndecided(): Promise<CompanyRecommendation[]> {
    return prisma.companyRecommendation.findMany({ where: { humanDecision: null }, orderBy: { createdAt: "asc" } });
  },

  list(): Promise<CompanyRecommendation[]> {
    return prisma.companyRecommendation.findMany({ orderBy: { createdAt: "desc" } });
  },

  listForCycle(operatingCycleId: string): Promise<CompanyRecommendation[]> {
    return prisma.companyRecommendation.findMany({ where: { operatingCycleId }, orderBy: { createdAt: "desc" } });
  },
};

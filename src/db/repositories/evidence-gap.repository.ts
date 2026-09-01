import type { EvidenceGap } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateEvidenceGapInput {
  opportunityId: string;
  dimension: string;
  status: string;
  description: string;
  suggestedResearchQuestion: string;
  impactScore: number;
}

export const evidenceGapRepository = {
  create(input: CreateEvidenceGapInput): Promise<EvidenceGap> {
    return prisma.evidenceGap.create({ data: input });
  },

  findById(id: string): Promise<EvidenceGap | null> {
    return prisma.evidenceGap.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<EvidenceGap[]> {
    return prisma.evidenceGap.findMany({ where: { opportunityId }, orderBy: { impactScore: "desc" } });
  },

  listUnresolvedForOpportunity(opportunityId: string): Promise<EvidenceGap[]> {
    return prisma.evidenceGap.findMany({
      where: { opportunityId, status: { not: "RESOLVED" } },
      orderBy: { impactScore: "desc" },
    });
  },

  resolve(id: string, resolvedByEvidenceId: string | null): Promise<EvidenceGap> {
    return prisma.evidenceGap.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByEvidenceId },
    });
  },
};

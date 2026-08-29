import type { Evidence } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateEvidenceInput {
  claim: string;
  source: string;
  sourceType: string;
  sourceReference: string | null;
  collectedByAgentId: string;
  reliability: string;
  confidence: number;
  metadata: string | null;
}

export const evidenceRepository = {
  create(input: CreateEvidenceInput): Promise<Evidence> {
    return prisma.evidence.create({ data: input });
  },

  findById(id: string): Promise<Evidence | null> {
    return prisma.evidence.findUnique({ where: { id } });
  },

  findManyByIds(ids: string[]): Promise<Evidence[]> {
    return prisma.evidence.findMany({ where: { id: { in: ids } } });
  },

  updateVerificationStatus(id: string, verificationStatus: string): Promise<Evidence> {
    return prisma.evidence.update({ where: { id }, data: { verificationStatus } });
  },

  list(): Promise<Evidence[]> {
    return prisma.evidence.findMany({ orderBy: { createdAt: "desc" } });
  },
};

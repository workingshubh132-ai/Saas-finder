import type { SupportCase } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateSupportCaseInput {
  productId: string;
  customerRef: string;
  requestText: string;
}

/** OPEN -> ... -> RESOLVED/ESCALATED (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §25). */
export const supportCaseRepository = {
  create(input: CreateSupportCaseInput): Promise<SupportCase> {
    return prisma.supportCase.create({ data: { ...input, status: "OPEN" } });
  },

  findById(id: string): Promise<SupportCase | null> {
    return prisma.supportCase.findUnique({ where: { id } });
  },

  listForProduct(productId: string): Promise<SupportCase[]> {
    return prisma.supportCase.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<SupportCase> {
    return prisma.supportCase.update({ where: { id }, data: { status } });
  },

  setTriageRecommendation(id: string, triageRecommendation: string): Promise<SupportCase> {
    return prisma.supportCase.update({ where: { id }, data: { triageRecommendation } });
  },
};

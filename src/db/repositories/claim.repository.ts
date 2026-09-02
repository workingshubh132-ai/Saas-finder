import type { Claim } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateClaimInput {
  opportunityId: string;
  claimType: string;
  statement: string;
  importance: string;
  confidence: number;
  extractedFrom: string | null;
}

export interface UpdateClaimInput {
  status?: string;
  confidence?: number;
}

export const claimRepository = {
  create(input: CreateClaimInput): Promise<Claim> {
    return prisma.claim.create({ data: input });
  },

  findById(id: string): Promise<Claim | null> {
    return prisma.claim.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<Claim[]> {
    return prisma.claim.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
  },

  update(id: string, data: UpdateClaimInput): Promise<Claim> {
    return prisma.claim.update({ where: { id }, data });
  },
};

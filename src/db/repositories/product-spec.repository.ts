import type { ProductSpec } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProductSpecInput {
  productId: string;
  name: string;
  targetCustomer: string;
  coreProblem: string;
  coreWorkflow: string;
  content: string;
  nonGoals: string;
  groundedInClaimIds: string;
  groundedInEvidenceIds: string;
  generatedByAgentId: string;
}

/** Historized — a revised spec is always a new row, never an edit (docs/M6_ARCHITECTURE_PROPOSAL.md §3). */
export const productSpecRepository = {
  create(input: CreateProductSpecInput): Promise<ProductSpec> {
    return prisma.productSpec.create({ data: input });
  },

  findById(id: string): Promise<ProductSpec | null> {
    return prisma.productSpec.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<ProductSpec | null> {
    return prisma.productSpec.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  listForProduct(productId: string): Promise<ProductSpec[]> {
    return prisma.productSpec.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },
};

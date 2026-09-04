import type { PricingModel } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreatePricingModelInput {
  productId: string;
  tiers: string;
  unitEconomics: string;
  groundedInClaimIds: string;
  groundedInEvidenceIds: string;
}

/** Historized, like ProductSpec — a revised pricing proposal is a new row (docs/M7_ARCHITECTURE_PROPOSAL.md §21). */
export const pricingModelRepository = {
  create(input: CreatePricingModelInput): Promise<PricingModel> {
    return prisma.pricingModel.create({ data: input });
  },

  findById(id: string): Promise<PricingModel | null> {
    return prisma.pricingModel.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<PricingModel | null> {
    return prisma.pricingModel.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },
};

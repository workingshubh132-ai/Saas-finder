import type { BusinessHealth } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateBusinessHealthInput {
  productId: string;
  productHealth: number;
  customerHealth: number;
  revenueHealth: number;
  growthHealth: number;
  marginHealth: number;
  operationalHealth: number;
  risk: number;
  evidenceConfidence: number;
  compositeScore: number;
  state: string;
  reasons: string;
}

export const businessHealthRepository = {
  create(input: CreateBusinessHealthInput): Promise<BusinessHealth> {
    return prisma.businessHealth.create({ data: input });
  },

  findLatestForProduct(productId: string): Promise<BusinessHealth | null> {
    return prisma.businessHealth.findFirst({ where: { productId }, orderBy: { computedAt: "desc" } });
  },

  listForProduct(productId: string): Promise<BusinessHealth[]> {
    return prisma.businessHealth.findMany({ where: { productId }, orderBy: { computedAt: "desc" } });
  },
};

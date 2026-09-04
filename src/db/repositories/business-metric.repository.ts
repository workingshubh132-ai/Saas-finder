import type { BusinessMetric } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateBusinessMetricInput {
  productId: string;
  metricType: string;
  valueKind: string;
  value: number;
  source: string;
}

/** Structural "observed vs. estimated" enforcement (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §23). */
export const businessMetricRepository = {
  create(input: CreateBusinessMetricInput): Promise<BusinessMetric> {
    return prisma.businessMetric.create({ data: input });
  },

  listForProduct(productId: string): Promise<BusinessMetric[]> {
    return prisma.businessMetric.findMany({ where: { productId }, orderBy: { recordedAt: "desc" } });
  },

  listForProductByType(productId: string, metricType: string): Promise<BusinessMetric[]> {
    return prisma.businessMetric.findMany({ where: { productId, metricType }, orderBy: { recordedAt: "desc" } });
  },
};

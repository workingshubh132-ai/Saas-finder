import type { Anomaly } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateAnomalyInput {
  productId: string;
  metricType: string;
  direction: string;
  observedValue: number;
  baselineMean: number;
  baselineStdDev: number;
  zScore: number;
  reason: string;
}

export const anomalyRepository = {
  create(input: CreateAnomalyInput): Promise<Anomaly> {
    return prisma.anomaly.create({ data: input });
  },

  listForProduct(productId: string): Promise<Anomaly[]> {
    return prisma.anomaly.findMany({ where: { productId }, orderBy: { detectedAt: "desc" } });
  },
};

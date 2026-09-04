import type { GrowthExperimentResult } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateGrowthExperimentResultInput {
  growthExperimentId: string;
  baselineValue: number;
  experimentValue: number;
  sampleSize: number;
  observedChangePct: number;
  confidence: string;
  limitations: string;
  decision: string;
}

export const growthExperimentResultRepository = {
  create(input: CreateGrowthExperimentResultInput): Promise<GrowthExperimentResult> {
    return prisma.growthExperimentResult.create({ data: input });
  },

  listForExperiment(growthExperimentId: string): Promise<GrowthExperimentResult[]> {
    return prisma.growthExperimentResult.findMany({ where: { growthExperimentId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForExperiment(growthExperimentId: string): Promise<GrowthExperimentResult | null> {
    return prisma.growthExperimentResult.findFirst({ where: { growthExperimentId }, orderBy: { createdAt: "desc" } });
  },
};

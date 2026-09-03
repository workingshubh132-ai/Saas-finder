import type { Feature } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateFeatureInput {
  productSpecId: string;
  description: string;
  problemAddressed: string;
  claimId: string;
  evidenceIds: string;
  expectedLearning: string;
  customerValue: number;
  learningValue: number;
  implementationCost: number;
  technicalRisk: number;
  score: number;
  priority: string;
  reasoning: string;
}

export const featureRepository = {
  create(input: CreateFeatureInput): Promise<Feature> {
    return prisma.feature.create({ data: input });
  },

  listForProductSpec(productSpecId: string): Promise<Feature[]> {
    return prisma.feature.findMany({ where: { productSpecId }, orderBy: { score: "desc" } });
  },

  listBuildNowForProductSpec(productSpecId: string): Promise<Feature[]> {
    return prisma.feature.findMany({ where: { productSpecId, priority: "BUILD_NOW" }, orderBy: { score: "desc" } });
  },
};

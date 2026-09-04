import type { GoToMarketPlan } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateGoToMarketPlanInput {
  productId: string;
  channels: string;
  landingPageSpec: string;
  experiments: string;
  groundedInClaimIds: string;
}

/** Historized, like MvpArchitecture — no status of its own (docs/M7_ARCHITECTURE_PROPOSAL.md §22). */
export const goToMarketPlanRepository = {
  create(input: CreateGoToMarketPlanInput): Promise<GoToMarketPlan> {
    return prisma.goToMarketPlan.create({ data: input });
  },

  findById(id: string): Promise<GoToMarketPlan | null> {
    return prisma.goToMarketPlan.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<GoToMarketPlan | null> {
    return prisma.goToMarketPlan.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },
};

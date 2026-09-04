import type { LaunchPlan } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateLaunchPlanInput {
  productId: string;
  deploymentPlanId?: string | null;
  summary: string;
}

/** A thin roll-up, no independent status (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §33). */
export const launchPlanRepository = {
  create(input: CreateLaunchPlanInput): Promise<LaunchPlan> {
    return prisma.launchPlan.create({ data: input });
  },

  findById(id: string): Promise<LaunchPlan | null> {
    return prisma.launchPlan.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<LaunchPlan | null> {
    return prisma.launchPlan.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  attachPricingModel(id: string, pricingModelId: string): Promise<LaunchPlan> {
    return prisma.launchPlan.update({ where: { id }, data: { pricingModelId } });
  },

  attachGoToMarketPlan(id: string, goToMarketPlanId: string): Promise<LaunchPlan> {
    return prisma.launchPlan.update({ where: { id }, data: { goToMarketPlanId } });
  },

  updateSummary(id: string, summary: string): Promise<LaunchPlan> {
    return prisma.launchPlan.update({ where: { id }, data: { summary } });
  },
};

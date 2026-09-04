import type { BillingPlan } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateBillingPlanInput {
  productId: string;
  pricingModelId: string;
  provider: string;
}

/** DRAFT -> HUMAN_APPROVED -> ACTIVE -> SUSPENDED/CANCELLED (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §19). */
export const billingPlanRepository = {
  create(input: CreateBillingPlanInput): Promise<BillingPlan> {
    return prisma.billingPlan.create({ data: { ...input, status: "DRAFT" } });
  },

  findById(id: string): Promise<BillingPlan | null> {
    return prisma.billingPlan.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<BillingPlan | null> {
    return prisma.billingPlan.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<BillingPlan> {
    return prisma.billingPlan.update({ where: { id }, data: { status } });
  },

  attachApprovalRequest(id: string, approvalRequestId: string): Promise<BillingPlan> {
    return prisma.billingPlan.update({ where: { id }, data: { approvalRequestId } });
  },
};

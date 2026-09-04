import type { BillingAccount } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateBillingAccountInput {
  billingPlanId: string;
  provider: string;
  providerProductRef: string;
  providerPriceRef: string;
  webhookSecret: string;
  activatedByIdentityId: string;
  activatedAt: Date;
}

/** Created only by the ACTIVATE_BILLING EXECUTE step (docs/M7_ARCHITECTURE_PROPOSAL.md §19). */
export const billingAccountRepository = {
  create(input: CreateBillingAccountInput): Promise<BillingAccount> {
    return prisma.billingAccount.create({ data: { ...input, status: "ACTIVE" } });
  },

  findById(id: string): Promise<BillingAccount | null> {
    return prisma.billingAccount.findUnique({ where: { id } });
  },

  findLatestForPlan(billingPlanId: string): Promise<BillingAccount | null> {
    return prisma.billingAccount.findFirst({ where: { billingPlanId }, orderBy: { activatedAt: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<BillingAccount> {
    return prisma.billingAccount.update({ where: { id }, data: { status } });
  },
};

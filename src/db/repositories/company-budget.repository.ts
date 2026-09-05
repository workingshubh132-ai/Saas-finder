import type { CompanyBudget } from "@prisma/client";
import { prisma } from "../client.js";

export const companyBudgetRepository = {
  findByPeriod(period: string): Promise<CompanyBudget | null> {
    return prisma.companyBudget.findUnique({ where: { period } });
  },

  create(input: { period: string; ceilingUsd: number }): Promise<CompanyBudget> {
    return prisma.companyBudget.create({ data: { ...input, updatedAt: new Date() } });
  },

  setConsumed(period: string, consumedUsd: number): Promise<CompanyBudget> {
    return prisma.companyBudget.update({ where: { period }, data: { consumedUsd, updatedAt: new Date() } });
  },

  list(): Promise<CompanyBudget[]> {
    return prisma.companyBudget.findMany({ orderBy: { period: "desc" } });
  },
};

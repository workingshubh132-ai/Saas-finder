import type { ResourceAllocation } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateResourceAllocationInput {
  category: string;
  period: string;
  productId?: string | null;
  allocated: number;
  consumed: number;
}

export const resourceAllocationRepository = {
  create(input: CreateResourceAllocationInput): Promise<ResourceAllocation> {
    return prisma.resourceAllocation.create({ data: input });
  },

  findOne(category: string, period: string, productId: string | null): Promise<ResourceAllocation | null> {
    return prisma.resourceAllocation.findFirst({ where: { category, period, productId } });
  },

  update(id: string, data: { allocated?: number; consumed?: number }): Promise<ResourceAllocation> {
    return prisma.resourceAllocation.update({ where: { id }, data });
  },

  listForPeriod(period: string): Promise<ResourceAllocation[]> {
    return prisma.resourceAllocation.findMany({ where: { period }, orderBy: { category: "asc" } });
  },
};

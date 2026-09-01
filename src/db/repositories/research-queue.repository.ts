import type { ResearchQueueItem } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateQueueItemInput {
  opportunityId: string;
  evidenceGapId: string | null;
  kind: string;
  priorityScore: number;
  reason: string;
}

export const researchQueueRepository = {
  create(input: CreateQueueItemInput): Promise<ResearchQueueItem> {
    return prisma.researchQueueItem.create({ data: input });
  },

  findById(id: string): Promise<ResearchQueueItem | null> {
    return prisma.researchQueueItem.findUnique({ where: { id } });
  },

  findHighestPriorityPending(): Promise<ResearchQueueItem | null> {
    return prisma.researchQueueItem.findFirst({ where: { status: "PENDING" }, orderBy: { priorityScore: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<ResearchQueueItem> {
    return prisma.researchQueueItem.update({ where: { id }, data: { status } });
  },

  list(filter: { status?: string } = {}): Promise<ResearchQueueItem[]> {
    return prisma.researchQueueItem.findMany({ where: { status: filter.status }, orderBy: { priorityScore: "desc" } });
  },
};

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

  /** M4 — the one active (not yet DONE/SKIPPED) item already tracking a
   *  given gap, if any: lets populateForOpportunity refresh a
   *  re-analyzed gap's priority in place instead of duplicating it
   *  (docs/M4_ARCHITECTURE_PROPOSAL.md §16 — a real latent gap in the
   *  M3 function once a gap can be updated in place, not just created
   *  once). */
  findActiveByEvidenceGapId(evidenceGapId: string): Promise<ResearchQueueItem | null> {
    return prisma.researchQueueItem.findFirst({ where: { evidenceGapId, status: { in: ["PENDING", "IN_PROGRESS"] } } });
  },

  updateStatus(id: string, status: string): Promise<ResearchQueueItem> {
    return prisma.researchQueueItem.update({ where: { id }, data: { status } });
  },

  updatePriority(id: string, priorityScore: number, reason: string): Promise<ResearchQueueItem> {
    return prisma.researchQueueItem.update({ where: { id }, data: { priorityScore, reason } });
  },

  list(filter: { status?: string } = {}): Promise<ResearchQueueItem[]> {
    return prisma.researchQueueItem.findMany({ where: { status: filter.status }, orderBy: { priorityScore: "desc" } });
  },
};

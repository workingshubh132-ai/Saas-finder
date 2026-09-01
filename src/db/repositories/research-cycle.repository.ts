import type { ResearchCycle } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateResearchCycleInput {
  objective: string;
  startedByIdentityId: string;
  maxDurationMs: number;
  maxSignals: number;
  maxToolCalls: number;
  maxModelCalls: number;
  maxCostUsd: number;
}

export interface UpdateResearchCycleInput {
  status?: string;
  objective?: string;
  signalsCollected?: number;
  toolCallCount?: number;
  modelCallCount?: number;
  opportunitiesGenerated?: number;
  stoppedReason?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export const researchCycleRepository = {
  create(input: CreateResearchCycleInput): Promise<ResearchCycle> {
    return prisma.researchCycle.create({ data: input });
  },

  findById(id: string): Promise<ResearchCycle | null> {
    return prisma.researchCycle.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateResearchCycleInput): Promise<ResearchCycle> {
    return prisma.researchCycle.update({ where: { id }, data });
  },

  list(filter: { status?: string } = {}): Promise<ResearchCycle[]> {
    return prisma.researchCycle.findMany({ where: { status: filter.status }, orderBy: { createdAt: "desc" } });
  },
};

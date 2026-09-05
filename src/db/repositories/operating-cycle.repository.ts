import type { CycleStageEvent, OperatingCycle } from "@prisma/client";
import { NotFoundError } from "../../domain/shared/errors.js";
import { prisma } from "../client.js";

export interface CreateOperatingCycleInput {
  objective: string;
  scope: string;
  status?: string;
  stage?: string;
  kind: string;
  maxCostUsd: number;
  riskLevel: string;
  deadline?: Date | null;
  owner: string;
  idempotencyKey?: string | null;
  retriedFromCycleId?: string | null;
  startedByIdentityId: string;
  scheduledFor?: Date | null;
  startedAt?: Date | null;
}

export interface UpdateOperatingCycleInput {
  status?: string;
  stage?: string;
  consumedCostUsd?: number;
  stoppedReason?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
}

export interface ListOperatingCyclesFilter {
  status?: string;
  stage?: string;
}

export const operatingCycleRepository = {
  create(input: CreateOperatingCycleInput): Promise<OperatingCycle> {
    return prisma.operatingCycle.create({ data: input });
  },

  findById(id: string): Promise<OperatingCycle | null> {
    return prisma.operatingCycle.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<OperatingCycle> {
    const cycle = await prisma.operatingCycle.findUnique({ where: { id } });
    if (!cycle) throw new NotFoundError("OperatingCycle", id);
    return cycle;
  },

  findByIdempotencyKey(idempotencyKey: string): Promise<OperatingCycle | null> {
    return prisma.operatingCycle.findUnique({ where: { idempotencyKey } });
  },

  update(id: string, data: UpdateOperatingCycleInput): Promise<OperatingCycle> {
    return prisma.operatingCycle.update({ where: { id }, data });
  },

  list(filter: ListOperatingCyclesFilter = {}): Promise<OperatingCycle[]> {
    return prisma.operatingCycle.findMany({ where: { status: filter.status, stage: filter.stage }, orderBy: { createdAt: "desc" } });
  },

  listActive(): Promise<OperatingCycle[]> {
    return prisma.operatingCycle.findMany({ where: { status: { in: ["SCHEDULED", "RUNNING", "PAUSED", "AWAITING_HUMAN"] } }, orderBy: { createdAt: "desc" } });
  },

  createStageEvent(input: { cycleId: string; stage: string; summary?: string | null }): Promise<CycleStageEvent> {
    return prisma.cycleStageEvent.create({ data: input });
  },

  completeStageEvent(id: string, summary: string | null): Promise<CycleStageEvent> {
    return prisma.cycleStageEvent.update({ where: { id }, data: { completedAt: new Date(), summary } });
  },

  findOpenStageEvent(cycleId: string, stage: string): Promise<CycleStageEvent | null> {
    return prisma.cycleStageEvent.findFirst({ where: { cycleId, stage, completedAt: null }, orderBy: { enteredAt: "desc" } });
  },

  listStageEvents(cycleId: string): Promise<CycleStageEvent[]> {
    return prisma.cycleStageEvent.findMany({ where: { cycleId }, orderBy: { enteredAt: "asc" } });
  },

  /** Cross-cycle, for the Company Timeline's own time-based correlation with Event rows (§43) — Event carries no cycleId FK by design (§1), so the join is by time window, not by key. */
  listAllStageEvents(since?: Date): Promise<CycleStageEvent[]> {
    return prisma.cycleStageEvent.findMany({ where: since ? { enteredAt: { gte: since } } : undefined, orderBy: { enteredAt: "asc" } });
  },

  listCompletedStages(cycleId: string): Promise<CycleStageEvent[]> {
    return prisma.cycleStageEvent.findMany({ where: { cycleId, completedAt: { not: null } }, orderBy: { enteredAt: "asc" } });
  },
};

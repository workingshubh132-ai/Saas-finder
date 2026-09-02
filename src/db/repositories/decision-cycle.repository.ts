import type { DecisionCycle } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateDecisionCycleInput {
  opportunityId: string;
  startedByIdentityId: string;
  maxClaims: number;
  maxValidatorSearches: number;
  maxModelCalls: number;
  maxResearchTasks: number;
  maxCeoPlanningSteps: number;
  maxDurationMs: number;
}

export interface UpdateDecisionCycleInput {
  status?: string;
  claimsValidated?: number;
  validatorSearchCount?: number;
  modelCallCount?: number;
  researchTasksCreated?: number;
  ceoPlanningSteps?: number;
  stoppedReason?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export const decisionCycleRepository = {
  create(input: CreateDecisionCycleInput): Promise<DecisionCycle> {
    return prisma.decisionCycle.create({ data: input });
  },

  findById(id: string): Promise<DecisionCycle | null> {
    return prisma.decisionCycle.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateDecisionCycleInput): Promise<DecisionCycle> {
    return prisma.decisionCycle.update({ where: { id }, data });
  },

  list(filter: { status?: string; opportunityId?: string } = {}): Promise<DecisionCycle[]> {
    return prisma.decisionCycle.findMany({ where: { status: filter.status, opportunityId: filter.opportunityId }, orderBy: { createdAt: "desc" } });
  },
};

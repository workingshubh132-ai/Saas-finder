import type { DecisionOutcome } from "@prisma/client";
import { NotFoundError } from "../../domain/shared/errors.js";
import { prisma } from "../client.js";

export interface CreateDecisionOutcomeInput {
  decisionType: string;
  decisionResourceId: string;
  expectedMetricType?: string | null;
  expectedValue?: number | null;
}

export const decisionOutcomeRepository = {
  create(input: CreateDecisionOutcomeInput): Promise<DecisionOutcome> {
    return prisma.decisionOutcome.create({ data: input });
  },

  findById(id: string): Promise<DecisionOutcome | null> {
    return prisma.decisionOutcome.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<DecisionOutcome> {
    const outcome = await prisma.decisionOutcome.findUnique({ where: { id } });
    if (!outcome) throw new NotFoundError("DecisionOutcome", id);
    return outcome;
  },

  evaluate(id: string, actualValue: number, evaluatedAt: Date, learningRecordId: string | null): Promise<DecisionOutcome> {
    return prisma.decisionOutcome.update({ where: { id }, data: { actualValue, evaluatedAt, learningRecordId } });
  },

  listForResource(decisionType: string, decisionResourceId: string): Promise<DecisionOutcome[]> {
    return prisma.decisionOutcome.findMany({ where: { decisionType, decisionResourceId }, orderBy: { createdAt: "desc" } });
  },

  list(): Promise<DecisionOutcome[]> {
    return prisma.decisionOutcome.findMany({ orderBy: { createdAt: "desc" } });
  },

  /** Past decisions of the same kind that generated a real lesson (docs/M9_ARCHITECTURE_PROPOSAL.md §27's own "have we made this mistake before" question). */
  listWithLearningRecordByType(decisionType: string): Promise<DecisionOutcome[]> {
    return prisma.decisionOutcome.findMany({ where: { decisionType, learningRecordId: { not: null } }, orderBy: { createdAt: "desc" } });
  },
};

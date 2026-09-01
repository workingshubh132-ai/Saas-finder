import type { Problem } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProblemInput {
  clusterId: string;
  statement: string;
  customerSegment: string;
  workflow: string;
  pain: string;
  frequency: string;
  currentSolution: string;
  dissatisfaction: string;
  urgency: string;
  willingnessToPaySignal: string;
  evidenceCount: number;
  confidence: number;
  status: string;
}

export interface UpdateProblemInput {
  status?: string;
}

export const problemRepository = {
  create(input: CreateProblemInput): Promise<Problem> {
    return prisma.problem.create({ data: input });
  },

  findById(id: string): Promise<Problem | null> {
    return prisma.problem.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateProblemInput): Promise<Problem> {
    return prisma.problem.update({ where: { id }, data });
  },

  list(filter: { status?: string } = {}): Promise<Problem[]> {
    return prisma.problem.findMany({ where: { status: filter.status }, orderBy: { createdAt: "desc" } });
  },
};

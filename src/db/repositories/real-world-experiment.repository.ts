import type { RealWorldExperiment } from "@prisma/client";
import { NotFoundError } from "../../domain/shared/errors.js";
import { prisma } from "../client.js";

export interface CreateRealWorldExperimentInput {
  name: string;
  objective: string;
  createdByIdentityId: string;
}

export const realWorldExperimentRepository = {
  create(input: CreateRealWorldExperimentInput): Promise<RealWorldExperiment> {
    return prisma.realWorldExperiment.create({ data: input });
  },

  findById(id: string): Promise<RealWorldExperiment | null> {
    return prisma.realWorldExperiment.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<RealWorldExperiment> {
    const experiment = await prisma.realWorldExperiment.findUnique({ where: { id } });
    if (!experiment) throw new NotFoundError("RealWorldExperiment", id);
    return experiment;
  },

  setStatus(id: string, status: string, endedAt: Date | null): Promise<RealWorldExperiment> {
    return prisma.realWorldExperiment.update({ where: { id }, data: { status, endedAt } });
  },

  list(): Promise<RealWorldExperiment[]> {
    return prisma.realWorldExperiment.findMany({ orderBy: { startedAt: "desc" } });
  },
};

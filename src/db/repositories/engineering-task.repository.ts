import type { EngineeringTask } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateEngineeringTaskInput {
  mvpArchitectureId: string;
  productId: string;
  title: string;
  purpose: string;
  dependsOnTaskIds: string;
  allowedFiles: string;
  acceptanceCriteria: string;
  testsRequired: string;
  assignedAgentId: string;
}

export const engineeringTaskRepository = {
  create(input: CreateEngineeringTaskInput): Promise<EngineeringTask> {
    return prisma.engineeringTask.create({ data: input });
  },

  findById(id: string): Promise<EngineeringTask | null> {
    return prisma.engineeringTask.findUnique({ where: { id } });
  },

  listForProduct(productId: string): Promise<EngineeringTask[]> {
    return prisma.engineeringTask.findMany({ where: { productId }, orderBy: { createdAt: "asc" } });
  },

  listForMvpArchitecture(mvpArchitectureId: string): Promise<EngineeringTask[]> {
    return prisma.engineeringTask.findMany({ where: { mvpArchitectureId }, orderBy: { createdAt: "asc" } });
  },

  updateStatus(id: string, status: string): Promise<EngineeringTask> {
    return prisma.engineeringTask.update({ where: { id }, data: { status } });
  },

  recordAttempt(id: string, attemptCount: number): Promise<EngineeringTask> {
    return prisma.engineeringTask.update({ where: { id }, data: { attemptCount } });
  },

  recordImplementation(
    id: string,
    input: { filesChanged: string; implementationSummary: string; knownLimitations: string; dependencyRecords: string },
  ): Promise<EngineeringTask> {
    return prisma.engineeringTask.update({ where: { id }, data: input });
  },

  recordIntegrationTest(id: string, input: { integrationTestPassed: boolean; integrationTestOutput: string }): Promise<EngineeringTask> {
    return prisma.engineeringTask.update({ where: { id }, data: input });
  },
};

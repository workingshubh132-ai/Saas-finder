import type { QaReport } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateQaReportInput {
  engineeringTaskId: string;
  verdict: string;
  missingTests: string;
  findings: string;
  reasoning: string;
  reviewedByAgentId: string;
}

export const qaReportRepository = {
  create(input: CreateQaReportInput): Promise<QaReport> {
    return prisma.qaReport.create({ data: input });
  },

  findLatestForTask(engineeringTaskId: string): Promise<QaReport | null> {
    return prisma.qaReport.findFirst({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },

  listForTask(engineeringTaskId: string): Promise<QaReport[]> {
    return prisma.qaReport.findMany({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },
};

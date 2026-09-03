import type { CodeReview } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCodeReviewInput {
  engineeringTaskId: string;
  findings: string;
  hasBlockingFinding: boolean;
  reasoning: string;
  reviewedByAgentId: string;
}

export const codeReviewRepository = {
  create(input: CreateCodeReviewInput): Promise<CodeReview> {
    return prisma.codeReview.create({ data: input });
  },

  listForTask(engineeringTaskId: string): Promise<CodeReview[]> {
    return prisma.codeReview.findMany({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForTask(engineeringTaskId: string): Promise<CodeReview | null> {
    return prisma.codeReview.findFirst({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },
};

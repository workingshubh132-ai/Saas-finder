import type { SecurityReview } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateSecurityReviewInput {
  engineeringTaskId: string;
  verdict: string;
  findings: string;
  reasoning: string;
  reviewedByAgentId: string;
}

export const securityReviewRepository = {
  create(input: CreateSecurityReviewInput): Promise<SecurityReview> {
    return prisma.securityReview.create({ data: input });
  },

  findLatestForTask(engineeringTaskId: string): Promise<SecurityReview | null> {
    return prisma.securityReview.findFirst({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },

  listForTask(engineeringTaskId: string): Promise<SecurityReview[]> {
    return prisma.securityReview.findMany({ where: { engineeringTaskId }, orderBy: { createdAt: "desc" } });
  },
};

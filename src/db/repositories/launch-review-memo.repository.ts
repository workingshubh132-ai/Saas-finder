import type { LaunchReviewMemo } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateLaunchReviewMemoInput {
  productId: string;
  launchPlanId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  content: string;
  recommendation: string;
  confidence: number;
}

export interface RecordLaunchReviewHumanDecisionInput {
  humanDecision: string;
  humanReason: string | null;
  decidedByIdentityId: string;
}

/** Compiled with zero new model calls, mirrors ProductReviewMemo exactly (docs/M7_ARCHITECTURE_PROPOSAL.md §31). */
export const launchReviewMemoRepository = {
  create(input: CreateLaunchReviewMemoInput): Promise<LaunchReviewMemo> {
    return prisma.launchReviewMemo.create({ data: input });
  },

  findById(id: string): Promise<LaunchReviewMemo | null> {
    return prisma.launchReviewMemo.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<LaunchReviewMemo | null> {
    return prisma.launchReviewMemo.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  recordHumanDecision(id: string, input: RecordLaunchReviewHumanDecisionInput): Promise<LaunchReviewMemo> {
    return prisma.launchReviewMemo.update({ where: { id }, data: { ...input, decidedAt: new Date() } });
  },

  list(): Promise<LaunchReviewMemo[]> {
    return prisma.launchReviewMemo.findMany({ orderBy: { createdAt: "desc" } });
  },
};

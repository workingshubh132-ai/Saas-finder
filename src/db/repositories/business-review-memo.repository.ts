import type { BusinessReviewMemo } from "@prisma/client";
import { prisma } from "../client.js";
import { NotFoundError } from "../../domain/shared/errors.js";

export interface CreateBusinessReviewMemoInput {
  productId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  content: string;
  recommendation: string;
  confidence: number;
}

export const businessReviewMemoRepository = {
  create(input: CreateBusinessReviewMemoInput): Promise<BusinessReviewMemo> {
    return prisma.businessReviewMemo.create({ data: input });
  },

  findById(id: string): Promise<BusinessReviewMemo | null> {
    return prisma.businessReviewMemo.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<BusinessReviewMemo> {
    const memo = await prisma.businessReviewMemo.findUnique({ where: { id } });
    if (!memo) throw new NotFoundError("BusinessReviewMemo", id);
    return memo;
  },

  listForProduct(productId: string): Promise<BusinessReviewMemo[]> {
    return prisma.businessReviewMemo.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  list(): Promise<BusinessReviewMemo[]> {
    return prisma.businessReviewMemo.findMany({ orderBy: { createdAt: "desc" } });
  },

  recordHumanDecision(
    id: string,
    decision: string,
    reason: string | null,
    decidedByIdentityId: string,
  ): Promise<BusinessReviewMemo> {
    return prisma.businessReviewMemo.update({
      where: { id },
      data: { humanDecision: decision, humanReason: reason, decidedAt: new Date(), decidedByIdentityId },
    });
  },
};

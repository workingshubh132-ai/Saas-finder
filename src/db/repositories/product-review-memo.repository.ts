import type { ProductReviewMemo } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProductReviewMemoInput {
  productId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  content: string;
  recommendation: string;
  confidence: number;
}

export interface RecordHumanDecisionInput {
  humanDecision: string;
  humanReason: string | null;
  decidedByIdentityId: string;
}

export const productReviewMemoRepository = {
  create(input: CreateProductReviewMemoInput): Promise<ProductReviewMemo> {
    return prisma.productReviewMemo.create({ data: input });
  },

  findById(id: string): Promise<ProductReviewMemo | null> {
    return prisma.productReviewMemo.findUnique({ where: { id } });
  },

  listForProduct(productId: string): Promise<ProductReviewMemo[]> {
    return prisma.productReviewMemo.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  list(): Promise<ProductReviewMemo[]> {
    return prisma.productReviewMemo.findMany({ orderBy: { createdAt: "desc" } });
  },

  recordHumanDecision(id: string, input: RecordHumanDecisionInput): Promise<ProductReviewMemo> {
    return prisma.productReviewMemo.update({ where: { id }, data: { ...input, decidedAt: new Date() } });
  },
};

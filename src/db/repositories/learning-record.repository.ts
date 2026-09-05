import type { LearningRecord } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateLearningRecordInput {
  predictionOutcomeId?: string;
  businessReviewMemoId?: string;
  errorDescription: string;
  rootCause?: string;
  lesson?: string;
  suggestedProcessChange?: string;
}

export const learningRecordRepository = {
  create(input: CreateLearningRecordInput): Promise<LearningRecord> {
    return prisma.learningRecord.create({ data: input });
  },

  findById(id: string): Promise<LearningRecord | null> {
    return prisma.learningRecord.findUnique({ where: { id } });
  },

  list(): Promise<LearningRecord[]> {
    return prisma.learningRecord.findMany({ orderBy: { createdAt: "desc" } });
  },
};

import type { Briefing } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateBriefingInput {
  periodStart: Date;
  periodEnd: Date;
  content: string;
  status: string;
  decisionQueueSnapshot: string;
}

export const briefingRepository = {
  create(input: CreateBriefingInput): Promise<Briefing> {
    return prisma.briefing.create({ data: input });
  },

  findLatest(): Promise<Briefing | null> {
    return prisma.briefing.findFirst({ orderBy: { generatedAt: "desc" } });
  },

  list(): Promise<Briefing[]> {
    return prisma.briefing.findMany({ orderBy: { generatedAt: "desc" } });
  },
};

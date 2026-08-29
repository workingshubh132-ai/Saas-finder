import type { Memory } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateMemoryInput {
  type: string;
  subject: string;
  content: string;
  source: string | null;
  confidence: number | null;
  metadata: string | null;
}

export const memoryRepository = {
  create(input: CreateMemoryInput): Promise<Memory> {
    return prisma.memory.create({ data: input });
  },

  list(filter: { type?: string; subject?: string } = {}): Promise<Memory[]> {
    return prisma.memory.findMany({
      where: { type: filter.type, subject: filter.subject },
      orderBy: { createdAt: "desc" },
    });
  },
};

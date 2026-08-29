import type { ToolExecution } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateToolExecutionInput {
  executionId: string;
  toolId: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  completedAt: Date | null;
  durationMs: number | null;
}

export const toolExecutionRepository = {
  create(input: CreateToolExecutionInput): Promise<ToolExecution> {
    return prisma.toolExecution.create({ data: input });
  },

  listByExecution(executionId: string): Promise<ToolExecution[]> {
    return prisma.toolExecution.findMany({ where: { executionId }, orderBy: { startedAt: "asc" } });
  },
};

import type { AgentExecution } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateAgentExecutionInput {
  agentId: string;
  taskId: string | null;
  startedByIdentityId: string;
  input: string;
}

export interface UpdateAgentExecutionInput {
  status?: string;
  modelProvider?: string | null;
  modelName?: string | null;
  stepCount?: number;
  toolCallCount?: number;
  modelCallCount?: number;
  retryCount?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCostUsd?: number | null;
  output?: string | null;
  error?: string | null;
  errorCode?: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export const agentExecutionRepository = {
  create(input: CreateAgentExecutionInput): Promise<AgentExecution> {
    return prisma.agentExecution.create({ data: input });
  },

  findById(id: string): Promise<AgentExecution | null> {
    return prisma.agentExecution.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateAgentExecutionInput): Promise<AgentExecution> {
    return prisma.agentExecution.update({ where: { id }, data });
  },

  list(filter: { status?: string; agentId?: string } = {}): Promise<AgentExecution[]> {
    return prisma.agentExecution.findMany({
      where: { status: filter.status, agentId: filter.agentId },
      orderBy: { createdAt: "desc" },
    });
  },

  /** The company budget rollup's own read (docs/M9_ARCHITECTURE_PROPOSAL.md §50) — every execution created within the current period. */
  listCreatedSince(since: Date): Promise<AgentExecution[]> {
    return prisma.agentExecution.findMany({ where: { createdAt: { gte: since } } });
  },
};

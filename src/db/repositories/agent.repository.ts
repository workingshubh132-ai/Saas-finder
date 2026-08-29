import type { Agent } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateAgentInput {
  name: string;
  role: string;
  department: string;
  description: string;
  status: string;
  capabilities: string;
  modelProvider: string | null;
  modelName: string | null;
  parentAgentId: string | null;
  riskLevel: string;
}

export interface ListAgentsFilter {
  status?: string;
  department?: string;
}

export const agentRepository = {
  create(input: CreateAgentInput): Promise<Agent> {
    return prisma.agent.create({ data: input });
  },

  findById(id: string): Promise<Agent | null> {
    return prisma.agent.findUnique({ where: { id } });
  },

  list(filter: ListAgentsFilter = {}): Promise<Agent[]> {
    return prisma.agent.findMany({
      where: { status: filter.status, department: filter.department },
      orderBy: { createdAt: "desc" },
    });
  },

  updateStatus(id: string, status: string): Promise<Agent> {
    return prisma.agent.update({ where: { id }, data: { status } });
  },
};

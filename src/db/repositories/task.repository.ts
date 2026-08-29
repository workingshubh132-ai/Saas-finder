import type { Task } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateTaskInput {
  title: string;
  objective: string;
  assignedAgentId: string | null;
  parentTaskId: string | null;
  status: string;
  priority: string;
  riskLevel: string;
  input: string | null;
}

export interface UpdateTaskInput {
  status?: string;
  output?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface ListTasksFilter {
  status?: string;
  assignedAgentId?: string;
}

export const taskRepository = {
  create(input: CreateTaskInput): Promise<Task> {
    return prisma.task.create({ data: input });
  },

  findById(id: string): Promise<Task | null> {
    return prisma.task.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateTaskInput): Promise<Task> {
    return prisma.task.update({ where: { id }, data });
  },

  list(filter: ListTasksFilter = {}): Promise<Task[]> {
    return prisma.task.findMany({
      where: { status: filter.status, assignedAgentId: filter.assignedAgentId },
      orderBy: { createdAt: "desc" },
    });
  },
};

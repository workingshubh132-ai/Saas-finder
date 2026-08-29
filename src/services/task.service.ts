import type { Task } from "@prisma/client";
import { taskRepository } from "../db/repositories/task.repository.js";
import { isRiskLevel } from "../domain/risk/risk-level.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { isTaskPriority, isTaskStatus, TASK_STATUS_TRANSITIONS, type TaskStatus } from "../domain/task/task.types.js";
import { agentService, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

const TERMINAL_STATUSES: readonly TaskStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export interface CreateTaskParams {
  title: string;
  objective: string;
  assignedAgentId?: string | null;
  parentTaskId?: string | null;
  priority?: string;
  riskLevel: string;
  input?: unknown;
  actor: Actor;
}

export const taskService = {
  async createTask(params: CreateTaskParams): Promise<Task> {
    if (!isRiskLevel(params.riskLevel)) {
      throw new ValidationError(`Unknown risk level: ${params.riskLevel}`);
    }
    const priority = params.priority ?? "NORMAL";
    if (!isTaskPriority(priority)) {
      throw new ValidationError(`Unknown priority: ${priority}`);
    }
    if (params.assignedAgentId) {
      await agentService.getAgentOrThrow(params.assignedAgentId);
    }
    if (params.parentTaskId) {
      await taskService.getTaskOrThrow(params.parentTaskId);
    }

    const task = await taskRepository.create({
      title: params.title,
      objective: params.objective,
      assignedAgentId: params.assignedAgentId ?? null,
      parentTaskId: params.parentTaskId ?? null,
      status: "PENDING",
      priority,
      riskLevel: params.riskLevel,
      input: params.input !== undefined ? toJsonString(params.input) : null,
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "CREATE_TASK",
      resourceType: "TASK",
      resourceId: task.id,
      riskLevel: params.riskLevel,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "TASK_CREATED", payload: { taskId: task.id, title: task.title } });

    return task;
  },

  async getTaskOrThrow(id: string): Promise<Task> {
    const task = await taskRepository.findById(id);
    if (!task) throw new NotFoundError("Task", id);
    return task;
  },

  listTasks: taskRepository.list,

  async transition(params: {
    id: string;
    toStatus: string;
    actor: Actor;
    output?: unknown;
    error?: string;
  }): Promise<Task> {
    if (!isTaskStatus(params.toStatus)) {
      throw new ValidationError(`Unknown task status: ${params.toStatus}`);
    }
    const task = await taskService.getTaskOrThrow(params.id);
    if (!isTaskStatus(task.status)) {
      throw new ValidationError(`Corrupt stored status on task ${task.id}: ${task.status}`);
    }
    assertTransition("Task", TASK_STATUS_TRANSITIONS, task.status, params.toStatus);

    const now = new Date();
    const updated = await taskRepository.update(params.id, {
      status: params.toStatus,
      output: params.output !== undefined ? toJsonString(params.output) : undefined,
      error: params.error,
      startedAt: params.toStatus === "RUNNING" ? now : undefined,
      completedAt: TERMINAL_STATUSES.includes(params.toStatus) ? now : undefined,
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `TASK_STATUS_${task.status}_TO_${params.toStatus}`,
      resourceType: "TASK",
      resourceId: params.id,
      riskLevel: isRiskLevel(task.riskLevel) ? task.riskLevel : null,
      result: params.toStatus === "FAILED" ? "FAILURE" : "SUCCESS",
    });

    if (params.toStatus === "COMPLETED") {
      await eventBus.publish({ type: "TASK_COMPLETED", payload: { taskId: params.id } });
    } else if (params.toStatus === "FAILED") {
      await eventBus.publish({ type: "TASK_FAILED", payload: { taskId: params.id, error: params.error ?? null } });
    }

    return updated;
  },
};

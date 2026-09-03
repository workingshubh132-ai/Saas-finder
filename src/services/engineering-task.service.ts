import type { EngineeringTask } from "@prisma/client";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import { mvpArchitectureRepository } from "../db/repositories/mvp-architecture.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { ENGINEERING_TASK_STATUS_TRANSITIONS, MAX_TASK_ATTEMPTS, isEngineeringTaskStatus } from "../domain/engineering-task/engineering-task.types.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";

interface ParsedDesign {
  coreEntities: Array<{ name: string; fields: string[] }>;
}

/**
 * Converts an MvpArchitecture's MUST_HAVE surface into small, bounded,
 * reviewable tasks (docs/M6_ARCHITECTURE_PROPOSAL.md §12) — never one
 * BUILD_ENTIRE_MVP task. For the demo-scale architecture this
 * genuinely produces two tasks that touch DIFFERENT files (avoiding
 * any same-file multi-writer race, §11's "never two tasks in parallel
 * against the same workspace" taken seriously even for two SEQUENTIAL
 * tasks): the data store, then the API that depends on it.
 */
export const engineeringTaskService = {
  async decomposeFromArchitecture(mvpArchitectureId: string, assignedAgentId: string): Promise<EngineeringTask[]> {
    const architecture = await mvpArchitectureRepository.findById(mvpArchitectureId);
    if (!architecture) throw new NotFoundError("MvpArchitecture", mvpArchitectureId);
    const product = await productRepository.findById(architecture.productId);
    if (!product) throw new NotFoundError("Product", architecture.productId);

    const existing = await engineeringTaskRepository.listForMvpArchitecture(mvpArchitectureId);
    if (existing.length > 0) {
      throw new ValidationError(`MvpArchitecture ${mvpArchitectureId} already has ${existing.length} engineering task(s) — decomposition runs exactly once per architecture.`);
    }

    const design = fromJsonString<ParsedDesign>(architecture.designJson, { coreEntities: [] });
    const entity = design.coreEntities[0];
    if (!entity) {
      throw new ValidationError(`MvpArchitecture ${mvpArchitectureId} has no core entity to build engineering tasks around.`);
    }

    const storeTask = await engineeringTaskRepository.create({
      mvpArchitectureId,
      productId: product.id,
      title: `Implement the in-process ${entity.name} store`,
      purpose: `A durable-for-this-process, in-memory store for ${entity.name} records — the data layer the API task depends on.`,
      dependsOnTaskIds: toJsonString([]),
      allowedFiles: toJsonString(["src/store.ts", "tests/store.test.ts"]),
      acceptanceCriteria: toJsonString([
        `A create(fields) function that assigns a real id and createdAt, and returns the new ${entity.name} record.`,
        `A list() function that returns every ${entity.name} record created so far, newest first.`,
      ]),
      testsRequired: toJsonString([`A real test creating one ${entity.name} and asserting list() returns it.`]),
      assignedAgentId,
    });

    const apiTask = await engineeringTaskRepository.create({
      mvpArchitectureId,
      productId: product.id,
      title: `Implement the ${entity.name} API (create + list)`,
      purpose: `The core workflow's own HTTP surface — POST to create, GET to list — mounted on the already-scaffolded Express app.`,
      dependsOnTaskIds: toJsonString([storeTask.id]),
      allowedFiles: toJsonString(["src/routes.ts", "src/index.ts", "tests/routes.test.ts"]),
      acceptanceCriteria: toJsonString([
        `POST /api/${entity.name} creates a record via the store from task ${storeTask.id} and returns it with status 201.`,
        `POST /api/${entity.name} with a malformed body returns status 400 with a structured {error} body — never an unhandled exception.`,
        `GET /api/${entity.name} returns every record from the store as JSON.`,
      ]),
      testsRequired: toJsonString([`A real test posting a valid body and asserting the record round-trips through GET.`, `A real test posting an invalid body and asserting a 400 response.`]),
      assignedAgentId,
    });

    await auditService.record({
      actorType: "SYSTEM",
      actorId: null,
      action: "DECOMPOSE_ENGINEERING_TASKS",
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: "SUCCESS",
      metadata: { mvpArchitectureId, taskIds: [storeTask.id, apiTask.id] },
    });

    return [storeTask, apiTask];
  },

  async getOrThrow(id: string): Promise<EngineeringTask> {
    const task = await engineeringTaskRepository.findById(id);
    if (!task) throw new NotFoundError("EngineeringTask", id);
    return task;
  },

  listForProduct: engineeringTaskRepository.listForProduct,

  async setStatus(id: string, toStatus: string, actor: { actorType: "AGENT" | "HUMAN" | "SYSTEM"; actorId: string | null }): Promise<EngineeringTask> {
    if (!isEngineeringTaskStatus(toStatus)) {
      throw new ValidationError(`Unknown engineering task status: ${toStatus}`);
    }
    const task = await engineeringTaskService.getOrThrow(id);
    if (!isEngineeringTaskStatus(task.status)) {
      throw new ValidationError(`Corrupt stored status on engineering task ${task.id}: ${task.status}`);
    }
    assertTransition("EngineeringTask", ENGINEERING_TASK_STATUS_TRANSITIONS, task.status, toStatus);

    const updated = await engineeringTaskRepository.updateStatus(id, toStatus);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: `ENGINEERING_TASK_STATUS_${task.status}_TO_${toStatus}`,
      resourceType: "ENGINEERING_TASK",
      resourceId: id,
      result: "SUCCESS",
    });

    return updated;
  },

  /** Bounded retry (§28) — never an unbounded loop. Returns whether a retry is still allowed. */
  async recordAttempt(id: string): Promise<{ task: EngineeringTask; retriesRemaining: boolean }> {
    const task = await engineeringTaskService.getOrThrow(id);
    const attemptCount = task.attemptCount + 1;
    const updated = await engineeringTaskRepository.recordAttempt(id, attemptCount);
    return { task: updated, retriesRemaining: attemptCount < MAX_TASK_ATTEMPTS };
  },
};

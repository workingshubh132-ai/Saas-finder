import type { Problem } from "@prisma/client";
import { problemRepository, type CreateProblemInput } from "../db/repositories/problem.repository.js";
import { isProblemStatus, PROBLEM_STATUS_TRANSITIONS } from "../domain/problem/problem.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export const problemService = {
  async create(input: CreateProblemInput & { collectedByAgentId: string }): Promise<Problem> {
    if (!isProblemStatus(input.status)) {
      throw new ValidationError(`Unknown problem status: ${input.status}`);
    }
    const { collectedByAgentId, ...createInput } = input;
    const problem = await problemRepository.create(createInput);

    await auditService.record({
      actorType: "AGENT",
      actorId: collectedByAgentId,
      action: "PROBLEM_EXTRACTED",
      resourceType: "PROBLEM",
      resourceId: problem.id,
      result: "SUCCESS",
      metadata: { status: problem.status, confidence: problem.confidence, evidenceCount: problem.evidenceCount },
    });
    await eventBus.publish({
      type: "PROBLEM_EXTRACTED",
      payload: { problemId: problem.id, clusterId: problem.clusterId, status: problem.status },
    });

    return problem;
  },

  async getOrThrow(id: string): Promise<Problem> {
    const problem = await problemRepository.findById(id);
    if (!problem) throw new NotFoundError("Problem", id);
    return problem;
  },

  list: problemRepository.list,

  async transition(params: { id: string; toStatus: string; actorId: string }): Promise<Problem> {
    if (!isProblemStatus(params.toStatus)) {
      throw new ValidationError(`Unknown problem status: ${params.toStatus}`);
    }
    const problem = await problemService.getOrThrow(params.id);
    if (!isProblemStatus(problem.status)) {
      throw new ValidationError(`Corrupt stored status on problem ${problem.id}: ${problem.status}`);
    }
    assertTransition("Problem", PROBLEM_STATUS_TRANSITIONS, problem.status, params.toStatus);

    const updated = await problemRepository.update(params.id, { status: params.toStatus });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.actorId,
      action: `PROBLEM_STATUS_${problem.status}_TO_${params.toStatus}`,
      resourceType: "PROBLEM",
      resourceId: params.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

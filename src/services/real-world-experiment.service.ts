import type { RealWorldExperiment } from "@prisma/client";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { isRealWorldExperimentStatus } from "../domain/real-world/reality.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { realWorldExperimentRepository } from "../db/repositories/real-world-experiment.repository.js";
import { auditService } from "./audit.service.js";

export interface StartRealWorldExperimentParams {
  name: string;
  objective: string;
  startedBy: AuthenticatedActor;
}

/**
 * The one durable identity a real-world experiment's whole chain
 * (cycle -> opportunity -> customer -> product -> revenue -> outcome)
 * traces back to (docs/M10_REAL_WORLD_AUDIT.md §38). Deliberately not
 * risk-gated on its own — creating or closing this label triggers no
 * consequential action by itself; every step it groups is still gated
 * by whatever mechanism already governed it before M10 (Guardian,
 * approval, Chairman, Human Owner).
 */
export const realWorldExperimentService = {
  async start(params: StartRealWorldExperimentParams): Promise<RealWorldExperiment> {
    if (!params.name.trim() || !params.objective.trim()) {
      throw new ValidationError("A RealWorldExperiment requires a non-empty name and objective.");
    }
    const experiment = await realWorldExperimentRepository.create({
      name: params.name,
      objective: params.objective,
      createdByIdentityId: params.startedBy.identityId,
    });
    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: "START_REAL_WORLD_EXPERIMENT",
      resourceType: "REAL_WORLD_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { name: params.name },
    });
    return experiment;
  },

  async getOrThrow(id: string): Promise<RealWorldExperiment> {
    return realWorldExperimentRepository.getOrThrow(id);
  },

  list(): Promise<RealWorldExperiment[]> {
    return realWorldExperimentRepository.list();
  },

  async close(id: string, status: "COMPLETED" | "ABANDONED", actor: AuthenticatedActor): Promise<RealWorldExperiment> {
    if (!isRealWorldExperimentStatus(status)) {
      throw new ValidationError(`Invalid RealWorldExperiment status: ${status}`);
    }
    const updated = await realWorldExperimentRepository.setStatus(id, status, new Date());
    await auditService.record({
      actorType: actor.type,
      actorId: actor.id,
      action: "CLOSE_REAL_WORLD_EXPERIMENT",
      resourceType: "REAL_WORLD_EXPERIMENT",
      resourceId: id,
      result: "SUCCESS",
      metadata: { status },
    });
    return updated;
  },
};

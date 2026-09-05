import type { EmergencyStop } from "@prisma/client";
import { emergencyStopRepository } from "../db/repositories/emergency-stop.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { EmergencyStopActiveError, ValidationError } from "../domain/shared/errors.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { alertService } from "./alert.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

function toActor(actor: AuthenticatedActor): Actor {
  return { actorType: actor.type, actorId: actor.id };
}

/**
 * The company-wide kill switch (docs/M9_ARCHITECTURE_PROPOSAL.md §46,
 * §57) — fails closed: an error checking the stop's own state is
 * treated as "stop is active," never as "stop is inactive," so a
 * transient DB failure can never silently let consequential execution
 * through. Checked at exactly one place in the cycle machinery
 * (`schedulerService.advanceCycle`'s move into EXECUTING) and at every
 * EXECUTE-layer call site (§57) — never duplicated into a second,
 * driftable check.
 */
export const emergencyStopService = {
  async isActive(): Promise<boolean> {
    try {
      const active = await emergencyStopRepository.findActive();
      return active !== null;
    } catch {
      return true;
    }
  },

  async assertNotActive(): Promise<void> {
    if (await this.isActive()) {
      throw new EmergencyStopActiveError();
    }
  },

  getCurrent(): Promise<EmergencyStop | null> {
    return emergencyStopRepository.findActive();
  },

  list(): Promise<EmergencyStop[]> {
    return emergencyStopRepository.list();
  },

  /** Human-actor-gated (Constitution §8) — an agent may never halt or resume its own governance. */
  async activate(params: { actor: AuthenticatedActor; reason: string }): Promise<EmergencyStop> {
    assertHumanActor(toActor(params.actor));
    const existing = await emergencyStopRepository.findActive();
    if (existing) return existing;

    const stop = await emergencyStopRepository.create({ activatedByIdentityId: params.actor.identityId });
    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "EMERGENCY_STOP_ACTIVATED",
      resourceType: "EMERGENCY_STOP",
      resourceId: stop.id,
      result: "SUCCESS",
      reason: params.reason,
    });
    await eventBus.publish({ type: "EMERGENCY_STOP_ACTIVATED", payload: { emergencyStopId: stop.id, reason: params.reason } });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §35 — the highest-severity alert in the company: everything else waits on this.
    await alertService.raise({ alertType: "EMERGENCY_STOP", severity: "CRITICAL", resourceType: "COMPANY", resourceId: stop.id, message: `Company-wide emergency stop activated: ${params.reason}` });
    return stop;
  },

  async resume(params: { actor: AuthenticatedActor }): Promise<EmergencyStop> {
    assertHumanActor(toActor(params.actor));
    const existing = await emergencyStopRepository.findActive();
    if (!existing) {
      throw new ValidationError("No active emergency stop to resume from.");
    }

    const resumed = await emergencyStopRepository.resume(existing.id, params.actor.identityId);
    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "EMERGENCY_STOP_RESUMED",
      resourceType: "EMERGENCY_STOP",
      resourceId: resumed.id,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "EMERGENCY_STOP_RESUMED", payload: { emergencyStopId: resumed.id } });
    return resumed;
  },
};

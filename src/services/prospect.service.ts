import type { Prospect } from "@prisma/client";
import { prospectRepository, type CreateProspectInput, type UpdateProspectQualificationInput } from "../db/repositories/prospect.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { isProspectStatus, PROSPECT_STATUS_TRANSITIONS } from "../domain/prospect/prospect.types.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateProspectParams extends CreateProspectInput {
  actorType: ActorType;
  actorId: string | null;
}

export interface SetProspectStatusParams {
  id: string;
  toStatus: string;
  actorType: ActorType;
  actorId: string | null;
}

export interface MarkDoNotContactParams {
  id: string;
  reason: string;
  actorType: ActorType;
  actorId: string | null;
}

/**
 * Prospect CRUD + the one state-machine transition point (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §8) — mirrors claim.service.ts's own shape. Creation itself is
 * deterministic bookkeeping over whatever prospectResearcherService
 * already found; this service does not decide *who* a prospect is,
 * only persists, audits, and (for status) transitions it.
 */
export const prospectService = {
  async create(params: CreateProspectParams): Promise<Prospect> {
    const { actorType, actorId, ...createInput } = params;
    const prospect = await prospectRepository.create(createInput);

    await auditService.record({
      actorType,
      actorId,
      action: "CREATE_PROSPECT",
      resourceType: "PROSPECT",
      resourceId: prospect.id,
      result: "SUCCESS",
      metadata: { opportunityId: prospect.opportunityId, source: prospect.source, sourceUrl: prospect.sourceUrl },
    });
    await eventBus.publish({
      type: "PROSPECT_DISCOVERED",
      payload: { prospectId: prospect.id, opportunityId: prospect.opportunityId, icpProfileId: prospect.icpProfileId, source: prospect.source },
    });

    return prospect;
  },

  async getOrThrow(id: string): Promise<Prospect> {
    const prospect = await prospectRepository.findById(id);
    if (!prospect) throw new NotFoundError("Prospect", id);
    return prospect;
  },

  listForOpportunity: prospectRepository.listForOpportunity,

  async setQualification(id: string, toStatus: string, data: Omit<UpdateProspectQualificationInput, "status">, actor: { actorType: ActorType; actorId: string | null }): Promise<Prospect> {
    if (!isProspectStatus(toStatus)) {
      throw new ValidationError(`Unknown prospect status: ${toStatus}`);
    }
    const prospect = await prospectService.getOrThrow(id);
    if (!isProspectStatus(prospect.status)) {
      throw new ValidationError(`Corrupt stored status on prospect ${prospect.id}: ${prospect.status}`);
    }
    assertTransition("Prospect", PROSPECT_STATUS_TRANSITIONS, prospect.status, toStatus);

    const updated = await prospectRepository.updateQualification(id, { ...data, status: toStatus });

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "QUALIFY_PROSPECT",
      resourceType: "PROSPECT",
      resourceId: id,
      result: "SUCCESS",
      metadata: { qualificationStatus: data.qualificationStatus, icpFit: data.icpFit, toStatus },
    });

    return updated;
  },

  async setStatus(params: SetProspectStatusParams): Promise<Prospect> {
    if (!isProspectStatus(params.toStatus)) {
      throw new ValidationError(`Unknown prospect status: ${params.toStatus}`);
    }
    const prospect = await prospectService.getOrThrow(params.id);
    if (!isProspectStatus(prospect.status)) {
      throw new ValidationError(`Corrupt stored status on prospect ${prospect.id}: ${prospect.status}`);
    }
    assertTransition("Prospect", PROSPECT_STATUS_TRANSITIONS, prospect.status, params.toStatus);

    const updated = await prospectRepository.updateStatus(params.id, params.toStatus);

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: `PROSPECT_STATUS_${prospect.status}_TO_${params.toStatus}`,
      resourceType: "PROSPECT",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: {},
    });

    return updated;
  },

  /**
   * The one, explicitly-named way to pull a prospect out of the
   * pipeline (docs/M5_ARCHITECTURE_PROPOSAL.md §8) — a real safety
   * action, not a generic setStatus call, so it always carries a
   * `reason` and its own distinct audit action, mirroring why M4 gave
   * KILL its own explicit wiring rather than folding it into a bare
   * status setter. Legal from every non-terminal ProspectStatus by
   * construction (assertTransition still enforces it, never assumed).
   */
  async markDoNotContact(params: MarkDoNotContactParams): Promise<Prospect> {
    const prospect = await prospectService.getOrThrow(params.id);
    if (!isProspectStatus(prospect.status)) {
      throw new ValidationError(`Corrupt stored status on prospect ${prospect.id}: ${prospect.status}`);
    }
    assertTransition("Prospect", PROSPECT_STATUS_TRANSITIONS, prospect.status, "DO_NOT_CONTACT");

    const updated = await prospectRepository.updateStatus(params.id, "DO_NOT_CONTACT");

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: "MARK_PROSPECT_DO_NOT_CONTACT",
      resourceType: "PROSPECT",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: { fromStatus: prospect.status, reason: params.reason },
    });

    return updated;
  },
};

import type { OutreachMessage } from "@prisma/client";
import { outreachMessageRepository, type CreateOutreachMessageInput } from "../db/repositories/outreach-message.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { isOutreachMessageStatus, OUTREACH_MESSAGE_STATUS_TRANSITIONS } from "../domain/outreach-message/outreach-message.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateOutreachMessageParams extends CreateOutreachMessageInput {
  actorType: ActorType;
  actorId: string | null;
}

/**
 * OutreachMessage CRUD + status transitions (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §12-13) — mirrors prospect.service.ts's own shape. Never exposes an
 * update path for content/reasoning/prospectId/experimentId; the
 * repository itself has none (§12's structural enforcement).
 */
export const outreachMessageService = {
  async create(params: CreateOutreachMessageParams): Promise<OutreachMessage> {
    const { actorType, actorId, ...createInput } = params;
    const message = await outreachMessageRepository.create(createInput);

    await auditService.record({
      actorType,
      actorId,
      action: "DRAFT_OUTREACH_MESSAGE",
      resourceType: "OUTREACH_MESSAGE",
      resourceId: message.id,
      result: "SUCCESS",
      metadata: { experimentId: message.experimentId, prospectId: message.prospectId, claimBeingTestedId: message.claimBeingTestedId },
    });
    await eventBus.publish({
      type: "OUTREACH_MESSAGE_DRAFTED",
      payload: { messageId: message.id, experimentId: message.experimentId, prospectId: message.prospectId, expectedInformationGain: message.expectedInformationGain },
    });

    return message;
  },

  async getOrThrow(id: string): Promise<OutreachMessage> {
    const message = await outreachMessageRepository.findById(id);
    if (!message) throw new NotFoundError("OutreachMessage", id);
    return message;
  },

  listForExperiment: outreachMessageRepository.listForExperiment,

  async setStatus(id: string, toStatus: string, actor: { actorType: ActorType; actorId: string | null }): Promise<OutreachMessage> {
    if (!isOutreachMessageStatus(toStatus)) {
      throw new ValidationError(`Unknown outreach message status: ${toStatus}`);
    }
    const message = await outreachMessageService.getOrThrow(id);
    if (!isOutreachMessageStatus(message.status)) {
      throw new ValidationError(`Corrupt stored status on outreach message ${message.id}: ${message.status}`);
    }
    assertTransition("OutreachMessage", OUTREACH_MESSAGE_STATUS_TRANSITIONS, message.status, toStatus);

    const updated = await outreachMessageRepository.updateStatus(id, toStatus);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: `OUTREACH_MESSAGE_STATUS_${message.status}_TO_${toStatus}`,
      resourceType: "OUTREACH_MESSAGE",
      resourceId: id,
      result: "SUCCESS",
      metadata: {},
    });

    return updated;
  },
};

import type { CustomerResponse } from "@prisma/client";
import { customerResponseRepository } from "../db/repositories/customer-response.repository.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { outreachMessageService } from "./outreach-message.service.js";
import { prospectService } from "./prospect.service.js";

export interface RecordCustomerResponseParams {
  outreachMessageId: string;
  rawContent: string;
  actor: Actor;
}

/**
 * Response ingestion (docs/M5_ARCHITECTURE_PROPOSAL.md §14) — a human
 * pastes the raw response text tied to one already-CONTACTED
 * OutreachMessage. No connector abstraction is built for a single
 * implementer (brief §16's own explicit permission: "if no external
 * connector is available, human pastes response... that is
 * acceptable"). Requires a verified HUMAN actor — the response is
 * being manually transcribed from a real external channel VentureForge
 * has no programmatic access to.
 */
export const customerResponseService = {
  async record(params: RecordCustomerResponseParams): Promise<CustomerResponse> {
    assertHumanActor(params.actor);

    const message = await outreachMessageService.getOrThrow(params.outreachMessageId);
    if (message.status !== "CONTACTED") {
      throw new ValidationError(`OutreachMessage ${message.id} is not CONTACTED (status: ${message.status}) — a response can only be recorded for a message that was actually marked contacted.`);
    }
    if (params.rawContent.trim().length === 0) {
      throw new ValidationError("rawContent must not be empty.");
    }

    const response = await customerResponseRepository.create({
      outreachMessageId: message.id,
      prospectId: message.prospectId,
      rawContent: params.rawContent,
      enteredByIdentityId: params.actor.actorId ?? "unknown",
    });

    await prospectService.setStatus({ id: message.prospectId, toStatus: "RESPONDED", actorType: params.actor.actorType, actorId: params.actor.actorId });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "RECORD_CUSTOMER_RESPONSE",
      resourceType: "CUSTOMER_RESPONSE",
      resourceId: response.id,
      result: "SUCCESS",
      metadata: { outreachMessageId: message.id, prospectId: message.prospectId },
    });
    await eventBus.publish({
      type: "CUSTOMER_RESPONSE_RECORDED",
      payload: { responseId: response.id, outreachMessageId: message.id, prospectId: message.prospectId, experimentId: message.experimentId },
    });

    return response;
  },

  /**
   * The Response Analyst's own classification verdict — audited here,
   * not left to the raw repository call, mirroring
   * prospectService.setStatus/outreachMessageService.setStatus's own
   * discipline of never mutating a status field without a matching
   * audit row (docs/M5_ARCHITECTURE_PROPOSAL.md §28).
   */
  async markAnalyzed(id: string, classification: string, actorId: string): Promise<CustomerResponse> {
    const response = await customerResponseRepository.markAnalyzed(id, classification);

    await auditService.record({
      actorType: "AGENT",
      actorId,
      action: "CLASSIFY_RESPONSE",
      resourceType: "CUSTOMER_RESPONSE",
      resourceId: response.id,
      result: "SUCCESS",
      metadata: { classification },
    });

    return response;
  },

  async getOrThrow(id: string): Promise<CustomerResponse> {
    const response = await customerResponseRepository.findById(id);
    if (!response) throw new NotFoundError("CustomerResponse", id);
    return response;
  },

  listForProspect: customerResponseRepository.listForProspect,
  listForExperiment: customerResponseRepository.listForExperiment,
};

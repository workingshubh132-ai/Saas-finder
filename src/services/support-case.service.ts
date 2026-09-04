import type { SupportCase } from "@prisma/client";
import { supportCaseRepository } from "../db/repositories/support-case.repository.js";
import { SUPPORT_CASE_STATUS_TRANSITIONS, isSupportCaseStatus } from "../domain/support-case/support-case.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import type { Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateSupportCaseParams {
  productId: string;
  customerRef: string;
  requestText: string;
  actor: Actor;
}

/**
 * Support case lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §25)
 * — customerRef/requestText are human-pasted labels, never scraped or
 * enriched: the same privacy boundary M5 established for
 * Prospect/CustomerResponse (§36), no connector built for a single
 * implementer.
 */
export const supportCaseService = {
  async create(params: CreateSupportCaseParams): Promise<SupportCase> {
    const supportCase = await supportCaseRepository.create({ productId: params.productId, customerRef: params.customerRef, requestText: params.requestText });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "CREATE_SUPPORT_CASE",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      result: "SUCCESS",
      metadata: { supportCaseId: supportCase.id },
    });
    await eventBus.publish({ type: "SUPPORT_CASE_CREATED", payload: { supportCaseId: supportCase.id, productId: params.productId } });

    return supportCase;
  },

  async getOrThrow(id: string): Promise<SupportCase> {
    const supportCase = await supportCaseRepository.findById(id);
    if (!supportCase) throw new NotFoundError("SupportCase", id);
    return supportCase;
  },

  listForProduct: supportCaseRepository.listForProduct,

  /** Never called by the Support Agent itself (docs/DECISIONS.md #54's own "review never mutates the thing it reviews" precedent) — a human moves the case through its own lifecycle. */
  async setStatus(id: string, toStatus: string, actor: Actor): Promise<SupportCase> {
    if (!isSupportCaseStatus(toStatus)) throw new ValidationError(`Unknown support case status: ${toStatus}`);
    const supportCase = await supportCaseService.getOrThrow(id);
    if (!isSupportCaseStatus(supportCase.status)) throw new ValidationError(`Corrupt stored status on support case ${supportCase.id}: ${supportCase.status}`);
    assertTransition("SupportCase", SUPPORT_CASE_STATUS_TRANSITIONS, supportCase.status, toStatus);

    const updated = await supportCaseRepository.updateStatus(id, toStatus);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: `SUPPORT_CASE_${supportCase.status}_TO_${toStatus}`,
      resourceType: "SUPPORT_CASE",
      resourceId: id,
      result: "SUCCESS",
    });

    return updated;
  },
};

import type { OutreachMessageDelivery } from "@prisma/client";
import { outreachMessageDeliveryRepository } from "../db/repositories/outreach-message-delivery.repository.js";
import { hashOutreachMessage } from "../domain/approval/resource-snapshot.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { createOutboundMessageProvider } from "../providers/outbound-message-provider-factory.js";
import { checkRateLimit } from "../sources/rate-limiter.js";
import { assertHumanOrSystemActor, type Actor } from "./agent.service.js";
import { alertService } from "./alert.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { companyBudgetService } from "./company-budget.service.js";
import { emergencyStopService } from "./emergency-stop.service.js";
import { eventBus } from "./event-bus.js";
import { messageApprovalService } from "./message-approval.service.js";
import { outreachMessageService } from "./outreach-message.service.js";
import { prospectService } from "./prospect.service.js";

export interface SendOutboundMessageParams {
  outreachMessageId: string;
  actor: Actor;
}

/** A message that has already failed this many times is never retried automatically again — a human must look at it (docs/AUTONOMOUS_OPERATIONS_AUDIT.md, brief item 25). */
export const MAX_SEND_ATTEMPTS = 3;
const OUTBOUND_MESSAGE_RATE_LIMIT_PER_MINUTE = 5;

/**
 * The one, real, governed send path Autonomous Operations Phase A adds
 * (docs/AUTONOMOUS_OPERATIONS_AUDIT.md item 9) — everything the brief
 * asks for lives here, nowhere else: re-verifies the exact
 * ApprovalRequest is still APPROVED and unchanged (freshness), enforces
 * a rate limit and the company budget, is idempotent (a prior SENT
 * delivery is returned as-is, the provider is never called twice), and
 * records a real audit event plus the provider's own confirmation.
 * `assertHumanOrSystemActor`-gated — see that function's own doc
 * comment for exactly why SYSTEM may reach this and nothing else newly
 * gated by it.
 */
export const outboundMessageService = {
  async send(params: SendOutboundMessageParams): Promise<OutreachMessageDelivery> {
    assertHumanOrSystemActor(params.actor);
    // Fails closed (docs/M9_ARCHITECTURE_PROPOSAL.md §57) — checked at every EXECUTE-equivalent step.
    await emergencyStopService.assertNotActive();

    const message = await outreachMessageService.getOrThrow(params.outreachMessageId);

    // Idempotency floor: a message already SENT is never sent again, regardless of who calls this or how many times.
    const priorDeliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    const alreadySent = priorDeliveries.find((d) => d.status === "SENT");
    if (alreadySent) return alreadySent;
    if (priorDeliveries.length >= MAX_SEND_ATTEMPTS) {
      throw new ValidationError(`OutreachMessage ${message.id} has already failed to send ${priorDeliveries.length} time(s) — bounded retry exhausted; a human must review this before another attempt.`);
    }

    if (message.status !== "APPROVED_TO_CONTACT") {
      throw new ValidationError(`OutreachMessage ${message.id} is not APPROVED_TO_CONTACT (status: ${message.status}) — cannot send.`);
    }
    if (!message.approvalRequestId) {
      throw new ValidationError(`OutreachMessage ${message.id} has no bound ApprovalRequest.`);
    }
    const approvalRequest = await approvalService.getOrThrow(message.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" || approvalRequest.resourceType !== "OUTREACH_MESSAGE" || approvalRequest.resourceId !== message.id) {
      throw new NotFoundError("Approved ApprovalRequest for OutreachMessage", message.id);
    }
    // Change detection + approval expiration (docs/M9_ARCHITECTURE_PROPOSAL.md §38-39) — content/recipient must still match exactly what the human approved.
    await approvalService.assertFresh(approvalRequest, hashOutreachMessage(message));

    // NOTE: despite the name, this only computes {exceeded, consumedUsd, ceilingUsd} — it never throws on its own
    // (docs/SECURITY.md, scheduler.service.ts's own identical usage) — the caller must check `.exceeded` itself.
    const budgetCheck = await companyBudgetService.assertNotExceeded();
    if (budgetCheck.exceeded) {
      await alertService.raise({
        alertType: "BUDGET_EXHAUSTED",
        severity: "WARNING",
        resourceType: "OUTREACH_MESSAGE",
        resourceId: message.id,
        message: `Automatic send blocked: ${budgetCheck.reasoning}`,
      });
      throw new ValidationError(`Company Budget exceeded (consumed ${budgetCheck.consumedUsd} of ${budgetCheck.ceilingUsd}) — automatic send blocked; a human must review before continuing.`);
    }
    checkRateLimit("outbound_message", OUTBOUND_MESSAGE_RATE_LIMIT_PER_MINUTE);

    const prospect = await prospectService.getOrThrow(message.prospectId);
    const provider = createOutboundMessageProvider();
    const result = await provider.sendMessage({ destination: prospect.publicContactChannel, content: message.content, idempotencyKey: message.id });

    const delivery = await outreachMessageDeliveryRepository.create({
      outreachMessageId: message.id,
      provider: provider.id,
      status: result.status,
      providerRef: result.providerRef,
      detail: result.detail,
      sentByIdentityId: params.actor.actorId,
      sentAt: new Date(),
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `OUTBOUND_MESSAGE_SEND_${result.status}`,
      resourceType: "OUTREACH_MESSAGE",
      resourceId: message.id,
      result: result.status === "SENT" ? "SUCCESS" : "FAILURE",
      metadata: { deliveryId: delivery.id, providerRef: result.providerRef, provider: provider.id, attempt: priorDeliveries.length + 1 },
    });

    if (result.status === "SENT") {
      // Records the send as CONTACTED — the same transition markContacted always made, now reached automatically instead of by a human's own manual confirmation.
      await messageApprovalService.markContacted({ outreachMessageId: message.id, actor: params.actor });
      await eventBus.publish({ type: "OUTREACH_MESSAGE_CONTACTED", payload: { messageId: message.id, experimentId: message.experimentId, prospectId: message.prospectId, contactedByIdentityId: params.actor.actorId } });
    }
    await eventBus.publish({ type: "ACTION_EXECUTED", payload: { action: "SEND_OUTREACH_MESSAGE", resourceType: "OUTREACH_MESSAGE", resourceId: message.id, status: result.status } });

    return delivery;
  },
};

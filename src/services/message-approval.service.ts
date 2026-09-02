import type { ApprovalRequest, OutreachMessage } from "@prisma/client";
import { outreachMessageRepository } from "../db/repositories/outreach-message.repository.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { outreachMessageService } from "./outreach-message.service.js";
import { prospectService } from "./prospect.service.js";

export interface RequestMessageApprovalParams {
  outreachMessageId: string;
  requestedByAgentId: string;
}

export interface ApplyMessageDecisionParams {
  approvalRequestId: string;
  actor: Actor;
}

export interface MarkContactedParams {
  outreachMessageId: string;
  actor: Actor;
}

/**
 * The second hard human gate (docs/M5_ARCHITECTURE_PROPOSAL.md §2,
 * §13) — no code path in this system ever sends anything externally.
 * `OutreachMessage.content`/`prospectId` are already immutable by
 * construction (no update method in outreach-message.repository.ts,
 * §12); this service adds the human-decision layer on top, reusing
 * approvalService.decide UNMODIFIED, exactly like every other M1-M4
 * risk-gated action. Approval binds to the EXACT message row —
 * ApprovalRequest.resourceId is the message's own id, so "approve
 * message A" can never become "send message B."
 */
export const messageApprovalService = {
  /** DRAFT -> AWAITING_HUMAN_APPROVAL, both on the message and its prospect, with a real RED-risk ApprovalRequest bound to this exact message id. */
  async requestApproval(params: RequestMessageApprovalParams): Promise<ApprovalRequest> {
    const message = await outreachMessageService.getOrThrow(params.outreachMessageId);
    if (message.status !== "DRAFT") {
      throw new ValidationError(`OutreachMessage ${message.id} is not DRAFT (status: ${message.status}) — approval may only be requested for a fresh draft.`);
    }

    const approvalRequest = await approvalService.requestApproval({
      requestedByAgentId: params.requestedByAgentId,
      action: "SEND_OUTREACH_MESSAGE",
      description: `Approve sending this drafted outreach message to prospect ${message.prospectId}.`,
      riskLevel: "RED",
      resourceType: "OUTREACH_MESSAGE",
      resourceId: message.id,
      reason: message.reasoning,
    });

    await outreachMessageRepository.attachApprovalRequest(message.id, approvalRequest.id);
    await prospectService.setStatus({ id: message.prospectId, toStatus: "AWAITING_HUMAN_APPROVAL", actorType: "AGENT", actorId: params.requestedByAgentId });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.requestedByAgentId,
      action: "REQUEST_MESSAGE_APPROVAL",
      resourceType: "OUTREACH_MESSAGE",
      resourceId: message.id,
      result: "SUCCESS",
      metadata: { approvalRequestId: approvalRequest.id },
    });

    return approvalRequest;
  },

  /**
   * The one operation a human calls to turn an already-decided
   * ApprovalRequest into the message's/prospect's own real status
   * transition — mirrors decisionRecordService.applyHumanDecision's
   * own decoupled decision-vs-mutation pattern and idempotent
   * early-return exactly. Never itself sends anything; APPROVED only
   * ever reaches APPROVED_TO_CONTACT, a status that still requires a
   * separate, explicit markContacted call before it means anything.
   */
  async applyDecision(params: ApplyMessageDecisionParams): Promise<OutreachMessage> {
    assertHumanActor(params.actor);

    const approvalRequest = await approvalService.getOrThrow(params.approvalRequestId);
    if (approvalRequest.resourceType !== "OUTREACH_MESSAGE" || !approvalRequest.resourceId) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not tied to an OutreachMessage.`);
    }
    if (approvalRequest.status !== "APPROVED" && approvalRequest.status !== "REJECTED") {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} has not been decided yet (status: ${approvalRequest.status}).`);
    }

    const message = await outreachMessageService.getOrThrow(approvalRequest.resourceId);
    if (message.status === "APPROVED_TO_CONTACT" || message.status === "REJECTED") {
      return message; // Idempotent — already applied.
    }

    const toStatus = approvalRequest.status === "APPROVED" ? "APPROVED_TO_CONTACT" : "REJECTED";
    const updated = await outreachMessageService.setStatus(message.id, toStatus, { actorType: params.actor.actorType, actorId: params.actor.actorId });
    await prospectService.setStatus({ id: message.prospectId, toStatus, actorType: params.actor.actorType, actorId: params.actor.actorId });

    return updated;
  },

  /**
   * Human-Owner-only record-keeping (docs/M5_ARCHITECTURE_PROPOSAL.md
   * §13) — requires the message's OWN approvalRequestId to already be
   * APPROVED, re-verified here rather than trusting message.status
   * alone (mirrors decisionRecordService.applyHumanDecision's own
   * precondition check). There is no programmatic send capability
   * anywhere in this codebase for this call to trigger — the Human
   * Owner personally sends the approved text through their own
   * channel, then confirms it here.
   */
  async markContacted(params: MarkContactedParams): Promise<OutreachMessage> {
    assertHumanActor(params.actor);

    const message = await outreachMessageService.getOrThrow(params.outreachMessageId);
    if (message.status !== "APPROVED_TO_CONTACT") {
      throw new ValidationError(`OutreachMessage ${message.id} is not APPROVED_TO_CONTACT (status: ${message.status}) — cannot mark contacted.`);
    }
    if (!message.approvalRequestId) {
      throw new ValidationError(`OutreachMessage ${message.id} has no bound ApprovalRequest.`);
    }
    const approvalRequest = await approvalService.getOrThrow(message.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" || approvalRequest.resourceId !== message.id) {
      throw new NotFoundError("Approved ApprovalRequest for OutreachMessage", message.id);
    }

    const updated = await outreachMessageRepository.markContacted(message.id, params.actor.actorId ?? "unknown", new Date());
    await prospectService.setStatus({ id: message.prospectId, toStatus: "CONTACTED", actorType: params.actor.actorType, actorId: params.actor.actorId });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "MARK_MESSAGE_CONTACTED",
      resourceType: "OUTREACH_MESSAGE",
      resourceId: message.id,
      result: "SUCCESS",
      metadata: { prospectId: message.prospectId },
    });
    await eventBus.publish({
      type: "OUTREACH_MESSAGE_CONTACTED",
      payload: { messageId: message.id, experimentId: message.experimentId, prospectId: message.prospectId, contactedByIdentityId: updated.contactedByIdentityId },
    });

    return updated;
  },
};

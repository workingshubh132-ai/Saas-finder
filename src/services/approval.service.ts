import type { ApprovalRequest } from "@prisma/client";
import { approvalRepository } from "../db/repositories/approval.repository.js";
import { APPROVAL_STATUS_TRANSITIONS, isApprovalStatus } from "../domain/approval/approval.types.js";
import { isRiskLevel } from "../domain/risk/risk-level.js";
import { NotFoundError, SelfApprovalError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { agentService, assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface RequestApprovalParams {
  requestedByAgentId: string;
  action: string;
  description: string;
  riskLevel: string;
  resourceType?: string | null;
  resourceId?: string | null;
  evidenceIds?: string[];
  reason?: string | null;
  expiresAt?: Date | null;
}

export interface DecideParams {
  id: string;
  toStatus: string;
  reviewedBy: Actor;
  decisionReason?: string | null;
}

/**
 * The Approval Engine backing the Human Decision Queue. The one rule
 * every path here defends: no agent may mark its own action approved
 * (Constitution §8 of the M1 brief). Enforcement is two-layered —
 * `assertHumanActor` means only a verified HUMAN identity can call
 * decide() at all (M2_ARCHITECTURE_PROPOSAL.md §6 — an agent can never
 * present as one), and `SelfApprovalError` guards the case even if
 * that ever somehow didn't hold.
 */
export const approvalService = {
  async requestApproval(params: RequestApprovalParams): Promise<ApprovalRequest> {
    if (!isRiskLevel(params.riskLevel)) {
      throw new ValidationError(`Unknown risk level: ${params.riskLevel}`);
    }
    await agentService.getAgentOrThrow(params.requestedByAgentId);

    const request = await approvalRepository.create({
      requestedByAgentId: params.requestedByAgentId,
      action: params.action,
      description: params.description,
      riskLevel: params.riskLevel,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      evidence: params.evidenceIds ? toJsonString(params.evidenceIds) : null,
      reason: params.reason ?? null,
      expiresAt: params.expiresAt ?? null,
    });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.requestedByAgentId,
      action: "REQUEST_APPROVAL",
      resourceType: params.resourceType ?? "APPROVAL_REQUEST",
      resourceId: params.resourceId ?? request.id,
      riskLevel: params.riskLevel,
      result: "SUCCESS",
    });
    await eventBus.publish({
      type: "APPROVAL_REQUESTED",
      payload: { approvalRequestId: request.id, action: params.action, riskLevel: params.riskLevel },
    });

    return request;
  },

  async getOrThrow(id: string): Promise<ApprovalRequest> {
    const request = await approvalRepository.findById(id);
    if (!request) throw new NotFoundError("ApprovalRequest", id);
    return request;
  },

  listQueue: approvalRepository.listQueue,

  async decide(params: DecideParams): Promise<ApprovalRequest> {
    if (!isApprovalStatus(params.toStatus)) {
      throw new ValidationError(`Unknown approval status: ${params.toStatus}`);
    }
    assertHumanActor(params.reviewedBy);

    const request = await approvalService.getOrThrow(params.id);
    if (!isApprovalStatus(request.status)) {
      throw new ValidationError(`Corrupt stored status on approval request ${request.id}: ${request.status}`);
    }
    if (params.reviewedBy.actorId === request.requestedByAgentId) {
      throw new SelfApprovalError();
    }
    assertTransition("ApprovalRequest", APPROVAL_STATUS_TRANSITIONS, request.status, params.toStatus);

    const updated = await approvalRepository.decide(params.id, {
      status: params.toStatus,
      reviewedBy: params.reviewedBy.actorId,
      decisionReason: params.decisionReason ?? null,
    });

    await auditService.record({
      actorType: params.reviewedBy.actorType,
      actorId: params.reviewedBy.actorId,
      action: `APPROVAL_${request.status}_TO_${params.toStatus}`,
      resourceType: request.resourceType ?? "APPROVAL_REQUEST",
      resourceId: request.resourceId ?? request.id,
      riskLevel: isRiskLevel(request.riskLevel) ? request.riskLevel : null,
      result: "SUCCESS",
      reason: params.decisionReason ?? null,
    });

    if (params.toStatus === "APPROVED") {
      await eventBus.publish({ type: "APPROVAL_APPROVED", payload: { approvalRequestId: request.id } });
    } else if (params.toStatus === "REJECTED") {
      await eventBus.publish({ type: "APPROVAL_REJECTED", payload: { approvalRequestId: request.id } });
    }

    return updated;
  },

  /** REQUEST_MORE_EVIDENCE (Constitution §16/§28): defer with a reason. */
  requestMoreEvidence(params: { id: string; reviewedBy: Actor; decisionReason?: string | null }): Promise<ApprovalRequest> {
    return approvalService.decide({
      id: params.id,
      toStatus: "DEFERRED",
      reviewedBy: params.reviewedBy,
      decisionReason: params.decisionReason ?? "More evidence requested.",
    });
  },

  /** Re-queues a DEFERRED request once new evidence has been attached. */
  async requeue(id: string): Promise<ApprovalRequest> {
    const request = await approvalService.getOrThrow(id);
    if (!isApprovalStatus(request.status)) {
      throw new ValidationError(`Corrupt stored status on approval request ${request.id}: ${request.status}`);
    }
    assertTransition("ApprovalRequest", APPROVAL_STATUS_TRANSITIONS, request.status, "PENDING");
    return approvalRepository.requeue(id);
  },
};

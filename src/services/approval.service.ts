import type { ApprovalRequest } from "@prisma/client";
import { approvalRepository } from "../db/repositories/approval.repository.js";
import { approvalSnapshotRepository } from "../db/repositories/approval-snapshot.repository.js";
import { APPROVAL_STATUS_TRANSITIONS, isApprovalStatus } from "../domain/approval/approval.types.js";
import { checkApprovalFreshness, DEFAULT_APPROVAL_EXPIRY_DAYS } from "../domain/approval/staleness.js";
import { isRiskLevel } from "../domain/risk/risk-level.js";
import { NotFoundError, SelfApprovalError, StaleApprovalError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { agentService, assertHumanActor, type Actor } from "./agent.service.js";
import { alertService } from "./alert.service.js";
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
  /** Change detection's own capture point (docs/M9_ARCHITECTURE_PROPOSAL.md §39) — a deterministic hash over the resource's own consequential fields at request time. Optional, backward compatible with every pre-M9 call site. */
  resourceStateHash?: string | null;
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

    // docs/M9_ARCHITECTURE_PROPOSAL.md §38 — an approval with no expiry is indistinguishable from a stale one a
    // human forgot about; a real behavior change from every pre-M9 call site (documented, docs/DECISIONS.md).
    const expiresAt = params.expiresAt ?? new Date(Date.now() + DEFAULT_APPROVAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const request = await approvalRepository.create({
      requestedByAgentId: params.requestedByAgentId,
      action: params.action,
      description: params.description,
      riskLevel: params.riskLevel,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      evidence: params.evidenceIds ? toJsonString(params.evidenceIds) : null,
      reason: params.reason ?? null,
      expiresAt,
    });

    if (params.resourceStateHash && params.resourceType && params.resourceId) {
      await approvalSnapshotRepository.create({
        approvalRequestId: request.id,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        stateHash: params.resourceStateHash,
      });
    }

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
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the single choke point every ApprovalRequest decision passes through, so this is the ApprovalRequest half of the cross-milestone HUMAN_DECISION_MADE event (the four direct-humanDecision-column memo services fire the other half themselves).
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "APPROVAL_REQUEST", approvalRequestId: request.id, decision: params.toStatus } });

    return updated;
  },

  /**
   * Called at the START of every EXECUTE step
   * (docs/M9_ARCHITECTURE_PROPOSAL.md §38-39: `deploymentService.execute`,
   * `billingActivationService.activate`,
   * `growthExperimentExecutionService.approveToRun`). CHECK ONLY —
   * `APPROVED` has no legal outgoing transition
   * (`APPROVAL_STATUS_TRANSITIONS.APPROVED === []`, by design: an
   * approval is an immutable historical fact); this never mutates the
   * ApprovalRequest, it only decides whether EXECUTE may proceed
   * RIGHT NOW. `currentStateHash` is the caller's freshly-recomputed
   * hash of the live resource row at this exact moment — pass `null`
   * when the resource type has no snapshot hasher yet.
   */
  async assertFresh(approvalRequest: ApprovalRequest, currentStateHash: string | null): Promise<void> {
    const snapshot = await approvalSnapshotRepository.findByApprovalRequestId(approvalRequest.id);
    const reason = checkApprovalFreshness({
      expiresAt: approvalRequest.expiresAt,
      now: new Date(),
      approvedStateHash: snapshot?.stateHash ?? null,
      currentStateHash,
    });
    if (reason === "EXPIRED") {
      throw new StaleApprovalError(`STALE_APPROVAL: ApprovalRequest ${approvalRequest.id} expired at ${approvalRequest.expiresAt?.toISOString()} — a human must re-approve before this may execute.`);
    }
    if (reason === "RESOURCE_CHANGED") {
      throw new StaleApprovalError(`STALE_APPROVAL: the resource ApprovalRequest ${approvalRequest.id} approved has changed since approval — a human must re-approve the current version before this may execute.`);
    }
  },

  /**
   * Queue hygiene, distinct from `assertFresh` (docs/M9_ARCHITECTURE_PROPOSAL.md
   * §38) — a PENDING request whose `expiresAt` has passed while still
   * awaiting a human is legally transitioned PENDING -> EXPIRED (the
   * existing, already-legal transition), not merely flagged. Called
   * from the operating cycle's OBSERVING stage (§28's own sibling
   * sweep for prediction outcomes) — never a background timer.
   */
  async expireOverdue(): Promise<number> {
    const now = new Date();
    const pending = await approvalRepository.listQueue();
    let count = 0;
    for (const request of pending) {
      if (request.expiresAt !== null && request.expiresAt.getTime() < now.getTime()) {
        await approvalRepository.decide(request.id, { status: "EXPIRED", reviewedBy: "system:expiry-sweep", decisionReason: "Expired before a human reviewed it." });
        // docs/M9_ARCHITECTURE_PROPOSAL.md §35 — stale approval is one of the brief's own named alert sources.
        await alertService.raise({
          alertType: "STALE_APPROVAL",
          severity: "WARNING",
          resourceType: request.resourceType ?? "APPROVAL_REQUEST",
          resourceId: request.resourceId ?? request.id,
          message: `ApprovalRequest ${request.id} (${request.action}) expired at ${request.expiresAt.toISOString()} before a human reviewed it.`,
        });
        count += 1;
      }
    }
    return count;
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

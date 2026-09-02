import type { ApprovalRequest, DecisionRecord } from "@prisma/client";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { decisionRecordRepository } from "../db/repositories/decision-record.repository.js";
import { investmentMemoRepository } from "../db/repositories/investment-memo.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { ACTIONS_REQUIRING_APPROVAL, isCeoDecisionAction } from "../domain/decision/decision-action.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { opportunityService } from "./opportunity.service.js";

const RISK_LEVEL_FOR_ACTION: Readonly<Record<string, string>> = {
  KILL: "ORANGE",
  PREPARE_REVIEW: "YELLOW",
  HUMAN_REVIEW: "YELLOW",
};

const APPROVAL_ACTION_FOR_CEO_ACTION: Readonly<Record<string, string>> = {
  KILL: "KILL_OPPORTUNITY",
  PREPARE_REVIEW: "REVIEW_INVESTMENT_MEMO",
  HUMAN_REVIEW: "REVIEW_OPPORTUNITY",
};

export interface RequestApprovalForRecommendationParams {
  ceoRecommendationId: string;
  requestedByAgentId: string;
}

export interface ApplyHumanDecisionParams {
  approvalRequestId: string;
  actor: Actor;
}

/**
 * KILL/PREPARE_REVIEW/HUMAN_REVIEW wiring to the unchanged
 * approval/decision-queue infrastructure (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §20) — a CEO recommendation is NEVER auto-applied. Two separate
 * operations, preserving the same decision-record-decoupled-from-
 * resource-mutation pattern `approvalService` already established in
 * M1: requesting approval never mutates the opportunity; applying a
 * human's decision is a distinct, later, explicit call.
 */
export const decisionRecordService = {
  /**
   * KILL/PREPARE_REVIEW/HUMAN_REVIEW create an ApprovalRequest;
   * DEPRIORITIZE/INVESTIGATE/VALIDATE_CUSTOMER do not (§13 — none of
   * them mutate irreversible state, so none needs a human gate) and
   * this returns null for those, not an error.
   */
  async requestApprovalForRecommendation(params: RequestApprovalForRecommendationParams): Promise<ApprovalRequest | null> {
    const recommendation = await ceoRecommendationRepository.findById(params.ceoRecommendationId);
    if (!recommendation) throw new NotFoundError("CeoRecommendation", params.ceoRecommendationId);
    if (!isCeoDecisionAction(recommendation.action)) {
      throw new ValidationError(`Corrupt stored action on CEO recommendation ${recommendation.id}: ${recommendation.action}`);
    }
    if (!ACTIONS_REQUIRING_APPROVAL.has(recommendation.action)) return null;

    const riskLevel = RISK_LEVEL_FOR_ACTION[recommendation.action];
    const action = APPROVAL_ACTION_FOR_CEO_ACTION[recommendation.action];
    if (!riskLevel || !action) {
      throw new ValidationError(`No approval mapping configured for CEO action ${recommendation.action}.`);
    }

    return approvalService.requestApproval({
      requestedByAgentId: params.requestedByAgentId,
      action,
      description: `CEO recommends ${recommendation.action} for this opportunity.`,
      riskLevel,
      resourceType: "OPPORTUNITY",
      resourceId: recommendation.opportunityId,
      reason: recommendation.reasoning,
    });
  },

  /**
   * The one operation a human calls to turn an already-decided
   * ApprovalRequest into (a) an immutable historical DecisionRecord,
   * always, and (b) — only when APPROVED and the request is a
   * KILL_OPPORTUNITY — the single explicit call that actually sets
   * Opportunity.status = KILLED. Requires the caller to be a verified
   * HUMAN identity, the same defense-in-depth `approvalService.decide`
   * itself already applies, even though the ApprovalRequest was
   * necessarily already decided by a human to reach this point.
   */
  async applyHumanDecision(params: ApplyHumanDecisionParams): Promise<{ decisionRecord: DecisionRecord; killed: boolean }> {
    assertHumanActor(params.actor);

    const approvalRequest = await approvalService.getOrThrow(params.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" && approvalRequest.status !== "REJECTED") {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} has not been decided yet (status: ${approvalRequest.status}).`);
    }
    if (approvalRequest.resourceType !== "OPPORTUNITY" || !approvalRequest.resourceId) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not tied to an Opportunity — nothing for decisionRecordService to apply.`);
    }
    const opportunityId = approvalRequest.resourceId;

    const existing = await decisionRecordRepository.findByApprovalRequestId(approvalRequest.id);
    if (existing) {
      const currentOpportunity = await opportunityRepository.findById(opportunityId);
      return { decisionRecord: existing, killed: currentOpportunity?.status === "KILLED" };
    }

    const opportunity = await opportunityService.getOrThrow(opportunityId);
    const scoreRecords = await opportunityRepository.listScoreRecords(opportunityId);
    const latestScore = scoreRecords[0] ?? null;
    const ceoRecommendation = await ceoRecommendationRepository.findLatestForOpportunity(opportunityId);
    const chairmanReview = await chairmanReviewRepository.findLatestForOpportunity(opportunityId);
    const investmentMemo = await investmentMemoRepository.findLatestForOpportunity(opportunityId);

    const citedClaimIds = ceoRecommendation ? fromJsonString<string[]>(ceoRecommendation.citedClaimIds, []) : [];
    const acceptedClaimIds = approvalRequest.status === "APPROVED" ? citedClaimIds : [];
    const rejectedClaimIds = approvalRequest.status === "REJECTED" ? citedClaimIds : [];
    const missingEvidenceNoted = chairmanReview ? chairmanReview.missingEvidence : toJsonString([]);

    let killed = false;
    if (approvalRequest.status === "APPROVED" && approvalRequest.action === "KILL_OPPORTUNITY") {
      await opportunityService.transition({ id: opportunityId, toStatus: "KILLED", actor: params.actor });
      killed = true;
    }

    const decisionRecord = await decisionRecordRepository.create({
      opportunityId,
      approvalRequestId: approvalRequest.id,
      investmentMemoId: investmentMemo?.id ?? null,
      ceoRecommendationId: ceoRecommendation?.id ?? null,
      chairmanReviewId: chairmanReview?.id ?? null,
      humanDecision: approvalRequest.status,
      humanReason: approvalRequest.decisionReason,
      opportunityScoreAtDecision: opportunity.opportunityScore,
      confidenceAtDecision: opportunity.confidenceScore,
      killRiskAtDecision: latestScore?.killRiskScore ?? null,
      rejectedClaimIds: toJsonString(rejectedClaimIds),
      acceptedClaimIds: toJsonString(acceptedClaimIds),
      missingEvidenceNoted,
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: killed ? "OPPORTUNITY_KILLED" : "DECISION_RECORDED",
      resourceType: "OPPORTUNITY",
      resourceId: opportunityId,
      result: "SUCCESS",
      metadata: { decisionRecordId: decisionRecord.id, humanDecision: approvalRequest.status, ceoAction: ceoRecommendation?.action ?? null },
    });
    // Reserved in M3, first fired here (§1.2, §20, §27): one
    // self-contained snapshot, not a join across four tables.
    await eventBus.publish({
      type: "OPPORTUNITY_DECISION_RECORDED",
      payload: {
        decisionRecordId: decisionRecord.id,
        opportunityId,
        humanDecision: approvalRequest.status,
        ceoAction: ceoRecommendation?.action ?? null,
        chairmanDecision: chairmanReview?.decision ?? null,
        opportunityScore: opportunity.opportunityScore,
        confidenceScore: opportunity.confidenceScore,
        killRiskScore: latestScore?.killRiskScore ?? null,
        acceptedClaimIds,
        rejectedClaimIds,
      },
    });
    if (killed) {
      await eventBus.publish({ type: "OPPORTUNITY_KILLED", payload: { opportunityId, decisionRecordId: decisionRecord.id } });
    }

    return { decisionRecord, killed };
  },

  listForOpportunity: decisionRecordRepository.listForOpportunity,
  list: decisionRecordRepository.list,
};

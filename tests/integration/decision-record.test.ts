import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { ceoRecommendationRepository } from "../../src/db/repositories/ceo-recommendation.repository.js";
import { approvalService } from "../../src/services/approval.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimService } from "../../src/services/claim.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { decisionRecordService } from "../../src/services/decision-record.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";
import { humanOwner } from "../setup.js";

async function driveToKillRecommendation() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  for (const claimType of ["CUSTOMER_PROBLEM", "WILLINGNESS_TO_PAY"]) {
    const claim = claims.find((c) => c.claimType === claimType)!;
    await claimService.setStatus({ id: claim.id, toStatus: "CONTRADICTED", confidence: 0.1, actorType: "SYSTEM", actorId: null });
  }
  const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (ceoOutcome.status !== "COMPLETED") throw new Error("CEO reasoning failed in test setup");
  await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
  return { agents, opportunity, ceoRecommendation: ceoOutcome.result.recommendation };
}

describe("decisionRecordService", () => {
  it("requestApprovalForRecommendation creates a KILL_OPPORTUNITY ApprovalRequest at ORANGE risk for a KILL action", async () => {
    const { agents, ceoRecommendation } = await driveToKillRecommendation();
    expect(ceoRecommendation.action).toBe("KILL");

    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoRecommendation.id, requestedByAgentId: agents.ceoAgent.id });

    expect(approvalRequest).not.toBeNull();
    expect(approvalRequest?.action).toBe("KILL_OPPORTUNITY");
    expect(approvalRequest?.riskLevel).toBe("ORANGE");
    expect(approvalRequest?.status).toBe("PENDING");
  });

  it("returns null (no ApprovalRequest) for DEPRIORITIZE/INVESTIGATE/VALIDATE_CUSTOMER, and a real request for KILL/PREPARE_REVIEW/HUMAN_REVIEW", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const expectations: Array<[string, boolean]> = [
      ["DEPRIORITIZE", false],
      ["INVESTIGATE", false],
      ["VALIDATE_CUSTOMER", false],
      ["KILL", true],
      ["PREPARE_REVIEW", true],
      ["HUMAN_REVIEW", true],
    ];

    for (const [action, expectRequest] of expectations) {
      const recommendation = await ceoRecommendationRepository.create({
        opportunityId: opportunity.id,
        action,
        reasoning: `Test reasoning for ${action}.`,
        citedClaimIds: JSON.stringify(["some-claim-id"]),
        citedValidationReportIds: JSON.stringify([]),
        confidence: 0.5,
        priorityScore: 0.3,
      });

      const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: recommendation.id, requestedByAgentId: agents.ceoAgent.id });
      if (expectRequest) {
        expect(approvalRequest, `expected an ApprovalRequest for action ${action}`).not.toBeNull();
      } else {
        expect(approvalRequest, `expected no ApprovalRequest for action ${action}`).toBeNull();
      }
    }
  });

  it("applyHumanDecision kills the opportunity on an APPROVED KILL_OPPORTUNITY request, and is idempotent on a second call", async () => {
    const { agents, opportunity, ceoRecommendation } = await driveToKillRecommendation();
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoRecommendation.id, requestedByAgentId: agents.ceoAgent.id });
    expect(approvalRequest).not.toBeNull();

    await approvalService.decide({ id: approvalRequest!.id, toStatus: "APPROVED", reviewedBy: humanOwner });

    const applied = await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest!.id, actor: humanOwner });
    expect(applied.killed).toBe(true);

    const finalOpportunity = await opportunityService.getOrThrow(opportunity.id);
    expect(finalOpportunity.status).toBe("KILLED");

    expect(applied.decisionRecord.humanDecision).toBe("APPROVED");
    expect(JSON.parse(applied.decisionRecord.acceptedClaimIds)).toEqual(JSON.parse(ceoRecommendation.citedClaimIds));
    expect(JSON.parse(applied.decisionRecord.rejectedClaimIds)).toEqual([]);

    const appliedAgain = await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest!.id, actor: humanOwner });
    expect(appliedAgain.decisionRecord.id).toBe(applied.decisionRecord.id);
    expect(appliedAgain.killed).toBe(true);

    const events = await prisma.event.findMany({ where: { type: "OPPORTUNITY_KILLED" } });
    expect(events).toHaveLength(1);
    const decisionRecordedEvents = await prisma.event.findMany({ where: { type: "OPPORTUNITY_DECISION_RECORDED" } });
    expect(decisionRecordedEvents).toHaveLength(1);
  });

  it("does not kill the opportunity when the human REJECTS the kill request", async () => {
    const { agents, opportunity, ceoRecommendation } = await driveToKillRecommendation();
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoRecommendation.id, requestedByAgentId: agents.ceoAgent.id });

    await approvalService.decide({ id: approvalRequest!.id, toStatus: "REJECTED", reviewedBy: humanOwner, decisionReason: "The evidence isn't strong enough to kill yet." });
    const applied = await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest!.id, actor: humanOwner });

    expect(applied.killed).toBe(false);
    const finalOpportunity = await opportunityService.getOrThrow(opportunity.id);
    expect(finalOpportunity.status).not.toBe("KILLED");
    expect(JSON.parse(applied.decisionRecord.rejectedClaimIds)).toEqual(JSON.parse(ceoRecommendation.citedClaimIds));
  });

  it("refuses to apply a decision on an ApprovalRequest that hasn't been decided yet", async () => {
    const { agents, ceoRecommendation } = await driveToKillRecommendation();
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoRecommendation.id, requestedByAgentId: agents.ceoAgent.id });

    await expect(decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest!.id, actor: humanOwner })).rejects.toThrow();
  });
});

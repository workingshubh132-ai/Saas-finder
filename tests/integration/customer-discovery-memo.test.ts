import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { prospectService } from "../../src/services/prospect.service.js";
import { customerResponseService } from "../../src/services/customer-response.service.js";
import { responseAnalystService } from "../../src/services/response-analyst.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { claimConfidenceService } from "../../src/services/claim-confidence.service.js";
import { customerDiscoveryMemoService } from "../../src/services/customer-discovery-memo.service.js";
import { evidenceValidatorService } from "../../src/services/evidence-validator.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

async function makeAnalyzedPositiveResponseChain() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");

  const experiment = await outreachExperimentService.create({
    opportunityId: opportunity.id,
    claimId: claim.id,
    targetIcpProfileId: icpOutcome.result.icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: "Confirm willingness to pay.",
    researchQuestion: "How much do you currently spend solving this problem, if anything?",
    messageStrategy: "Learning, not selling.",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "3+ independent orgs describe real spending.",
    failureCriteria: "Fewer than 2 responses.",
  });
  await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

  const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpOutcome.result.icpProfile.id, organization: "Acme Co" });
  await prospectService.setQualification(
    prospect.id,
    "QUALIFIED",
    { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "Role matches ICP.", unknowns: JSON.stringify(["Actual budget authority"]) },
    { actorType: "SYSTEM", actorId: null },
  );

  const draft = await messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() });
  if (draft.status !== "COMPLETED") throw new Error("messageDrafterService.run did not complete");

  const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: draft.result.message.id, requestedByAgentId: agents.messageDrafterAgent.id });
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
  await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
  await messageApprovalService.markContacted({ outreachMessageId: draft.result.message.id, actor: HUMAN_OWNER });

  const response = await customerResponseService.record({
    outreachMessageId: draft.result.message.id,
    rawContent: "We currently pay about $150/month for a partial workaround and it's still a hassle.",
    actor: HUMAN_OWNER,
  });
  const analysis = await responseAnalystService.run({ agentId: agents.responseAnalystAgent.id, customerResponseId: response.id, startedBy: authActor() });
  if (analysis.status !== "COMPLETED") throw new Error("responseAnalystService.run did not complete");

  // Run the unmodified M4 Evidence Validator + confidence recalculation on the tested claim so it actually reaches a real SUPPORTED/etc. verdict — without this the claim stays UNVERIFIED and "strengthened" would be vacuously untestable.
  const validation = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: claim.id, maxSearches: 0, startedBy: authActor() });
  if (validation.status !== "COMPLETED") throw new Error("evidenceValidatorService.run did not complete");
  await claimConfidenceService.recalculateFromLatestReport({ claimId: claim.id, actorType: "SYSTEM", actorId: null });

  const ceoOutcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (ceoOutcome.status !== "COMPLETED") throw new Error("recommendCustomerDiscoveryAction did not complete");

  const { review } = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

  return { agents, opportunity, experiment, claim, ceoRecommendation: ceoOutcome.result.recommendation, chairmanReview: review };
}

describe("customerDiscoveryMemoService.compile", () => {
  it("compiles a complete memo — prospects contacted, responses, independent orgs, evidence, claims, CEO, Chairman, human PENDING", async () => {
    const { opportunity, experiment, claim, ceoRecommendation, chairmanReview } = await makeAnalyzedPositiveResponseChain();

    const { memo, content } = await customerDiscoveryMemoService.compile({
      experimentId: experiment.id,
      ceoRecommendationId: ceoRecommendation.id,
      chairmanReviewId: chairmanReview.id,
      actorType: "SYSTEM",
      actorId: null,
    });

    expect(memo.opportunityId).toBe(opportunity.id);
    expect(memo.experimentId).toBe(experiment.id);
    expect(memo.responseCount).toBe(1);
    expect(memo.independentOrganizationCount).toBe(1);
    expect(memo.humanDecision).toBeNull();

    expect(content.prospectsContacted).toBe(1);
    expect(content.responses).toHaveLength(1);
    expect(content.wtpEvidence.length).toBeGreaterThan(0);
    expect(content.remainingUncertainty).toContain("Actual budget authority");
    expect(content.ceo.action).toBe(ceoRecommendation.action);
    expect(content.chairman.decision).toBe(chairmanReview.decision);
    expect(content.human).toBe("PENDING");

    // The tested claim was pushed to SUPPORTED by real customer evidence (via the unmodified Evidence Validator) — it must show up as strengthened, not silently omitted.
    expect(content.claimsStrengthened.some((c) => c.claimId === claim.id)).toBe(true);
    expect(JSON.parse(memo.claimsStrengthened) as string[]).toContain(claim.id);
  });

  it("records exactly one human decision, idempotently", async () => {
    const { experiment, ceoRecommendation, chairmanReview } = await makeAnalyzedPositiveResponseChain();
    const { memo } = await customerDiscoveryMemoService.compile({
      experimentId: experiment.id,
      ceoRecommendationId: ceoRecommendation.id,
      chairmanReviewId: chairmanReview.id,
      actorType: "SYSTEM",
      actorId: null,
    });

    const decided = await customerDiscoveryMemoService.recordHumanDecision({ memoId: memo.id, decision: "APPROVE", reason: "Strong enough signal to proceed.", actor: HUMAN_OWNER });
    expect(decided.humanDecision).toBe("APPROVE");
    expect(decided.decidedAt).not.toBeNull();

    const second = await customerDiscoveryMemoService.recordHumanDecision({ memoId: memo.id, decision: "STOP", reason: "changed my mind", actor: HUMAN_OWNER });
    expect(second.humanDecision).toBe("APPROVE"); // Idempotent — the first decision stands.
  });

  it("refuses to record a human decision from a non-human actor", async () => {
    const { agents, experiment, ceoRecommendation, chairmanReview } = await makeAnalyzedPositiveResponseChain();
    const { memo } = await customerDiscoveryMemoService.compile({
      experimentId: experiment.id,
      ceoRecommendationId: ceoRecommendation.id,
      chairmanReviewId: chairmanReview.id,
      actorType: "SYSTEM",
      actorId: null,
    });

    await expect(
      customerDiscoveryMemoService.recordHumanDecision({ memoId: memo.id, decision: "APPROVE", reason: null, actor: { actorType: "AGENT", actorId: agents.ceoAgent.id } }),
    ).rejects.toThrow();
  });
});

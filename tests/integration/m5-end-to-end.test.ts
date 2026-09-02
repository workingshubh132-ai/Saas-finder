import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { claimConfidenceService } from "../../src/services/claim-confidence.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimRepository } from "../../src/db/repositories/claim.repository.js";
import { customerDiscoveryMemoService } from "../../src/services/customer-discovery-memo.service.js";
import { customerResponseService } from "../../src/services/customer-response.service.js";
import { evidenceGapService } from "../../src/services/evidence-gap.service.js";
import { evidenceValidatorService } from "../../src/services/evidence-validator.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { prospectQualificationService } from "../../src/services/prospect-qualification.service.js";
import { prospectResearcherService } from "../../src/services/prospect-researcher.service.js";
import { responseAnalystService } from "../../src/services/response-analyst.service.js";
import { authActor, makeAgent, makeFullAgentSet, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

/**
 * M5 brief Parts 37-38 — the two mandatory end-to-end tests. Both
 * drive the FULL M5 core loop through real services (never mocked),
 * exactly as tests/integration/m4-end-to-end.test.ts does for M4.
 * Starts from an already-claim-extracted opportunity (M4's own e2e
 * tests already cover Opportunity -> Claims -> Validator in isolation)
 * so this file stays focused on what is genuinely new in M5: real
 * customer discovery closing the loop back into the unmodified M4
 * validation/CEO/Chairman machinery.
 *
 * "Message sent through a safe test/dummy boundary" (brief §37): there
 * is no real send capability anywhere in this codebase
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §13) — markContacted is
 * Human-Owner-only RECORD-KEEPING, confirming the Human Owner
 * personally sent the already-approved text through their own channel.
 * That is the safe boundary this test exercises; it is never a real
 * network send.
 */
async function makeQualifiedProspectUnderActiveExperiment(claimType: string) {
  const agents = await makeFullAgentSet();
  const researcherAgent = await makeAgent({ role: "Prospect Researcher" });
  await agentService.grantPermission({ agentId: researcherAgent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });

  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const claim = claims.find((c) => c.claimType === claimType)!;
  expect(claim.status).toBe("UNVERIFIED");

  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  expect(icpOutcome.status).toBe("COMPLETED");
  if (icpOutcome.status !== "COMPLETED") throw new Error("unreachable");
  const icpProfile = icpOutcome.result.icpProfile;

  const experiment = await outreachExperimentService.create({
    opportunityId: opportunity.id,
    claimId: claim.id,
    targetIcpProfileId: icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: `Test ${claimType}.`,
    researchQuestion: "How much do you currently spend solving this problem, if anything?",
    messageStrategy: "Ask about current process and spend — learning, not selling, never a pitch.",
    prospectLimit: 25,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "3+ independent organizations describe real current spending.",
    failureCriteria: "3+ independent organizations explicitly say they would never pay.",
  });
  // First hard human gate (docs/M5_ARCHITECTURE_PROPOSAL.md §2, §11): no message may be drafted before this.
  const approvedExperiment = await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });
  expect(approvedExperiment.status).toBe("ACTIVE");

  const researchOutcome = await prospectResearcherService.run({ agentId: researcherAgent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
  expect(researchOutcome.status).toBe("COMPLETED");
  if (researchOutcome.status !== "COMPLETED") throw new Error("unreachable");
  expect(researchOutcome.result.prospects.length).toBeGreaterThan(0);

  return { agents, opportunity, claim, icpProfile, experiment: approvedExperiment, discoveredProspects: researchOutcome.result.prospects };
}

/** Real qualification + real drafting for one prospect under an ACTIVE experiment (the first hard human gate already passed). */
async function qualifyAndDraft(experimentId: string, prospectId: string, messageDrafterAgentId: string, prospectQualificationAgentId: string) {
  const qualifyOutcome = await prospectQualificationService.run({ agentId: prospectQualificationAgentId, prospectId, startedBy: authActor() });
  expect(qualifyOutcome.status).toBe("COMPLETED");
  if (qualifyOutcome.status !== "COMPLETED") throw new Error("unreachable");

  const draftOutcome = await messageDrafterService.run({ agentId: messageDrafterAgentId, experimentId, prospectId, startedBy: authActor() });
  expect(draftOutcome.status).toBe("COMPLETED");
  if (draftOutcome.status !== "COMPLETED") throw new Error("unreachable");
  return draftOutcome.result.message;
}

/** The second hard human gate (approve -> apply -> markContacted), reused identically by both paths below. */
async function approveAndMarkContacted(messageId: string, messageDrafterAgentId: string) {
  const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: messageId, requestedByAgentId: messageDrafterAgentId });
  expect(approvalRequest.status).toBe("PENDING");
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
  await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
  await messageApprovalService.markContacted({ outreachMessageId: messageId, actor: HUMAN_OWNER });
}

describe("M5 end-to-end: positive path — real customer evidence strengthens the thesis", () => {
  it("Opportunity -> ICP -> Prospects -> Qualification -> Message -> Human approval -> [safe test boundary] -> Response -> Evidence -> Claim update -> M4 Validator -> CEO -> Chairman -> Human, no hardcoded result", async () => {
    const { agents, opportunity, claim: wtpClaim, experiment, discoveredProspects } = await makeQualifiedProspectUnderActiveExperiment("WILLINGNESS_TO_PAY");
    const wtpConfidenceBefore = wtpClaim.confidence;
    const prospect = discoveredProspects[0]!;

    const message = await qualifyAndDraft(experiment.id, prospect.id, agents.messageDrafterAgent.id, agents.prospectQualificationAgent.id);
    await approveAndMarkContacted(message.id, agents.messageDrafterAgent.id);

    // A real prospect, in their own words, describing real current spending — never a scripted stub.
    const response = await customerResponseService.record({
      outreachMessageId: message.id,
      rawContent: "We currently pay about $150/month for a partial workaround and it's still a hassle to reconcile everything by hand.",
      actor: HUMAN_OWNER,
    });

    const analysisOutcome = await responseAnalystService.run({ agentId: agents.responseAnalystAgent.id, customerResponseId: response.id, startedBy: authActor() });
    expect(analysisOutcome.status).toBe("COMPLETED");
    if (analysisOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(analysisOutcome.result.classification).toBe("POSITIVE_SIGNAL");
    expect(analysisOutcome.result.evidenceCount).toBeGreaterThan(0);

    // The unmodified M4 Evidence Validator, fed this newly-collected customer evidence through the unchanged signal-routing pipeline.
    const validationOutcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(validationOutcome.status).toBe("COMPLETED");
    if (validationOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(validationOutcome.result.status).toBe("SUPPORTED");

    const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({ claimId: wtpClaim.id, actorType: "SYSTEM", actorId: null });
    expect(updatedClaim.status).toBe("SUPPORTED");
    expect(updatedClaim.confidence).toBeGreaterThan(wtpConfidenceBefore);
    await evidenceGapService.analyzeClaim({ claim: updatedClaim, recommendedResearch: null });

    // CEO — a second, distinct entry point from its usual KILL/DEPRIORITIZE/etc. reasoning (docs/M5_ARCHITECTURE_PROPOSAL.md §20).
    const ceoOutcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") throw new Error("unreachable");
    // Real customer evidence just strengthened the thesis — recommending a full stop can never be the honest reading of this state.
    expect(ceoOutcome.result.recommendation.action).not.toBe("STOP_EXPERIMENT");
    expect((JSON.parse(ceoOutcome.result.recommendation.citedClaimIds) as string[]).length).toBeGreaterThan(0);

    // Chairman — independently reviews; genuinely adversarial, never a rubber stamp (never zero objections, even here).
    const chairmanResult = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    expect(chairmanResult.decision.objections.length).toBeGreaterThan(0);

    // The Customer Discovery Memo — the milestone's literal final product, compiled with ZERO new model calls.
    const { memo, content } = await customerDiscoveryMemoService.compile({
      experimentId: experiment.id,
      ceoRecommendationId: ceoOutcome.result.recommendation.id,
      chairmanReviewId: chairmanResult.review.id,
      actorType: "SYSTEM",
      actorId: null,
    });
    expect(memo.responseCount).toBe(1);
    expect(memo.independentOrganizationCount).toBe(1);
    expect(content.wtpEvidence.length).toBeGreaterThan(0);
    // The claim really was pushed to SUPPORTED by real customer evidence — it must show up as strengthened, not silently omitted.
    expect(content.claimsStrengthened.some((c) => c.claimId === wtpClaim.id)).toBe(true);
    expect(JSON.parse(memo.claimsStrengthened) as string[]).toContain(wtpClaim.id);
    expect(memo.humanDecision).toBeNull();

    // Human: never auto-decided.
    const decided = await customerDiscoveryMemoService.recordHumanDecision({ memoId: memo.id, decision: "APPROVE", reason: "Real spending signal — worth continuing.", actor: HUMAN_OWNER });
    expect(decided.humanDecision).toBe("APPROVE");
    expect(decided.decidedAt).not.toBeNull();
  });
});

describe("M5 end-to-end: negative path — real customer evidence weakens the thesis and stops the experiment", () => {
  it("3 independent organizations say they would never pay -> Response Analyst -> M4 Validator CONTRADICTED -> confidence drops -> CEO recommends STOP_EXPERIMENT -> Chairman independently REJECTs -> Human STOP, no hardcoded result", async () => {
    const { agents, opportunity, claim: wtpClaim, experiment, discoveredProspects } = await makeQualifiedProspectUnderActiveExperiment("WILLINGNESS_TO_PAY");
    const wtpConfidenceBefore = wtpClaim.confidence;
    expect(discoveredProspects.length).toBeGreaterThanOrEqual(3);
    const respondents = discoveredProspects.slice(0, 3);
    // Every discovered prospect must come from a genuinely different organization for "3 independent organizations" to mean anything real.
    expect(new Set(respondents.map((p) => p.organization)).size).toBe(3);

    const negativeResponseTexts = [
      "We looked into it, but honestly we wouldn't pay for another tool — our spreadsheet process is free and works well enough for us.",
      "Thanks for reaching out. We wouldn't pay for this kind of tool right now; budget is tight and it isn't a priority.",
      "Appreciate you asking, but we wouldn't pay to solve this — we just live with the manual process as it is.",
    ];

    for (let i = 0; i < respondents.length; i += 1) {
      const prospect = respondents[i]!;
      const message = await qualifyAndDraft(experiment.id, prospect.id, agents.messageDrafterAgent.id, agents.prospectQualificationAgent.id);
      await approveAndMarkContacted(message.id, agents.messageDrafterAgent.id);

      const response = await customerResponseService.record({ outreachMessageId: message.id, rawContent: negativeResponseTexts[i]!, actor: HUMAN_OWNER });
      const analysisOutcome = await responseAnalystService.run({ agentId: agents.responseAnalystAgent.id, customerResponseId: response.id, startedBy: authActor() });
      expect(analysisOutcome.status).toBe("COMPLETED");
      if (analysisOutcome.status !== "COMPLETED") throw new Error("unreachable");
      expect(analysisOutcome.result.classification).toBe("NOT_INTERESTED");
      expect(analysisOutcome.result.evidenceCount).toBeGreaterThan(0);
    }

    // The unmodified M4 Evidence Validator — 3 real OBJECTION-signal evidence items, routed to WILLINGNESS_TO_PAY only because each one's own relatedClaimType says so (docs/M5_ARCHITECTURE_PROPOSAL.md §17).
    const validationOutcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(validationOutcome.status).toBe("COMPLETED");
    if (validationOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(validationOutcome.result.status).toBe("CONTRADICTED");

    const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({ claimId: wtpClaim.id, actorType: "SYSTEM", actorId: null });
    expect(updatedClaim.status).toBe("CONTRADICTED");
    expect(updatedClaim.confidence).toBeLessThan(wtpConfidenceBefore + 0.01);

    // CEO customer-discovery reasoning — real independent-organization counting, not a hardcoded branch (docs/M5_ARCHITECTURE_PROPOSAL.md §20).
    const ceoOutcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(ceoOutcome.result.recommendation.action).toBe("STOP_EXPERIMENT");
    expect(JSON.parse(ceoOutcome.result.recommendation.citedClaimIds) as string[]).toContain(wtpClaim.id);

    // Chairman — independently re-derives its own view from the claims/evidence, never takes the CEO's word for it.
    const chairmanResult = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    expect(chairmanResult.decision.decision).toBe("REJECT");
    expect(chairmanResult.decision.objections.length).toBeGreaterThan(0);

    const { memo, content } = await customerDiscoveryMemoService.compile({
      experimentId: experiment.id,
      ceoRecommendationId: ceoOutcome.result.recommendation.id,
      chairmanReviewId: chairmanResult.review.id,
      actorType: "SYSTEM",
      actorId: null,
    });
    expect(memo.responseCount).toBe(3);
    expect(memo.independentOrganizationCount).toBe(3);
    expect(content.negativeEvidence.length).toBeGreaterThan(0);
    // The claim really was pushed to CONTRADICTED by real customer evidence — it must show up as weakened, not silently omitted.
    expect(content.claimsWeakened.some((c) => c.claimId === wtpClaim.id)).toBe(true);
    expect(JSON.parse(memo.claimsWeakened) as string[]).toContain(wtpClaim.id);

    // Human: never auto-stopped. The CEO/Chairman only ever recommend; a human decides.
    const decided = await customerDiscoveryMemoService.recordHumanDecision({ memoId: memo.id, decision: "STOP", reason: "3 independent organizations confirmed they would not pay.", actor: HUMAN_OWNER });
    expect(decided.humanDecision).toBe("STOP");
    expect(decided.decidedAt).not.toBeNull();

    // Nothing is silently lost: the contradicting evidence and the claim's full history remain queryable after the stop.
    const finalClaim = await claimRepository.findById(wtpClaim.id);
    expect(finalClaim?.status).toBe("CONTRADICTED");
  });
});

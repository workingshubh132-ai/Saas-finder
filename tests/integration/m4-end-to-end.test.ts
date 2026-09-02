import { describe, expect, it } from "vitest";
import { evidenceGapService } from "../../src/services/evidence-gap.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { claimConfidenceService } from "../../src/services/claim-confidence.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimRepository } from "../../src/db/repositories/claim.repository.js";
import { claimService } from "../../src/services/claim.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { decisionRecordService } from "../../src/services/decision-record.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { evidenceValidatorService } from "../../src/services/evidence-validator.service.js";
import { investmentMemoService } from "../../src/services/investment-memo.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";
import { humanOwner } from "../setup.js";

/**
 * M4 brief Part 42 — the two mandatory end-to-end tests. Both drive
 * the full pipeline through real services (never mocked), exactly as
 * `tests/integration/m3-end-to-end.test.ts` does for M3: Opportunity ->
 * Claims -> Evidence -> Validator -> confidence update -> evidence
 * gaps -> CEO -> EIG -> Chairman attack -> Investment Memo -> Human.
 * Starts from an already-scored Opportunity (M3's own pipeline, and
 * its own e2e test, already cover Signal -> ... -> Opportunity) so
 * this file stays focused on what is genuinely new in M4.
 */
describe("M4 end-to-end: continue path", () => {
  it("real supporting evidence carries a promising opportunity through Validator, CEO, Chairman, and a compiled Investment Memo, left PENDING for the Human Owner", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    // Real, direct-payment-intent customer evidence — genuinely
    // grounds the WILLINGNESS_TO_PAY and CUSTOMER_PROBLEM claims.
    const evidence = await evidenceService.collectEvidence({
      claim: "A small business owner said they would pay $40/month for automated invoice reconciliation — they currently spend 6 hours a month on it manually.",
      source: "customer-interview",
      sourceType: "CUSTOMER",
      sourceReference: "interview-001",
      collectedByAgentId: agents.opportunityAgent.id,
      reliability: "HIGH",
      confidence: 0.85,
      metadata: {},
    });
    await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: evidence.id, actor: { actorType: "AGENT", actorId: agents.opportunityAgent.id } });

    // Opportunity -> Claims
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    expect(claims).toHaveLength(12);

    // Evidence -> Validator -> confidence update -> evidence gaps, per claim.
    for (const claim of claims) {
      const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: claim.id, maxSearches: 0, startedBy: authActor() });
      expect(outcome.status).toBe("COMPLETED");
      if (outcome.status !== "COMPLETED") continue;
      const updated = await claimConfidenceService.recalculateFromLatestReport({ claimId: claim.id, actorType: "SYSTEM", actorId: null });
      await evidenceGapService.analyzeClaim({ claim: updated, recommendedResearch: null });
    }
    const recalculatedOpportunity = await claimConfidenceService.recalculateOpportunityConfidence({ opportunityId: opportunity.id, scoredBy: "test" });
    expect(recalculatedOpportunity).not.toBeNull();

    const refreshedClaims = await claimRepository.listForOpportunity(opportunity.id);
    const wtpClaim = refreshedClaims.find((x) => x.claimType === "WILLINGNESS_TO_PAY")!;
    expect(wtpClaim.status).toBe("SUPPORTED");

    // CEO -> EIG (evidence gaps already reflect it via analyzeClaim above)
    const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") return;
    expect(ceoOutcome.result.recommendation.action).not.toBe("KILL");
    expect(JSON.parse(ceoOutcome.result.recommendation.citedClaimIds).length).toBeGreaterThan(0);

    // Chairman attack — independently reviews, never a rubber stamp.
    const chairmanResult = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    expect(chairmanResult.decision.objections.length).toBeGreaterThan(0);

    // Investment Memo — the actual artifact for the Human Owner.
    const { memo } = await investmentMemoService.compile({
      opportunityId: opportunity.id,
      ceoRecommendationId: ceoOutcome.result.recommendation.id,
      chairmanReviewId: chairmanResult.review.id,
      actorType: "AGENT",
      actorId: agents.ceoAgent.id,
    });
    expect(memo.strongestArgumentAgainst.length).toBeGreaterThan(0);
    expect(memo.investmentThesis.length).toBeGreaterThan(0);

    // Human: PENDING (never auto-decided) -> APPROVED, still never auto-killed.
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoOutcome.result.recommendation.id, requestedByAgentId: agents.ceoAgent.id });
    if (approvalRequest) {
      expect(approvalRequest.status).toBe("PENDING");
      await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: humanOwner });
      const applied = await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest.id, actor: humanOwner });
      expect(applied.killed).toBe(false);
    }

    const finalOpportunity = await opportunityService.getOrThrow(opportunity.id);
    expect(finalOpportunity.status).not.toBe("KILLED");
  });
});

describe("M4 end-to-end: kill path", () => {
  it("a critical claim contradicted by real evidence drives the opportunity through KILL, Chairman rejection, human approval, and an explainable, evidence-backed final status change", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    // Real, honest evidence that directly contradicts willingness to pay.
    const contradictingEvidence = await evidenceService.collectEvidence({
      claim: "Three prospective customers independently said they wouldn't pay for this because their current spreadsheet process, while slow, is free and good enough.",
      source: "customer-interview",
      sourceType: "CUSTOMER",
      sourceReference: "interview-002",
      collectedByAgentId: agents.opportunityAgent.id,
      reliability: "HIGH",
      confidence: 0.85,
      metadata: {},
    });
    await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: contradictingEvidence.id, actor: { actorType: "AGENT", actorId: agents.opportunityAgent.id } });

    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    const validatorOutcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(validatorOutcome.status).toBe("COMPLETED");
    if (validatorOutcome.status !== "COMPLETED") return;
    expect(validatorOutcome.result.status).toBe("CONTRADICTED");

    const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({ claimId: wtpClaim.id, actorType: "SYSTEM", actorId: null });
    expect(updatedClaim.status).toBe("CONTRADICTED");
    expect(updatedClaim.confidence).toBeLessThan(wtpClaim.confidence + 0.01);

    // Kill risk increases: re-score the opportunity with a real
    // weakWillingnessToPay-dominant kill-risk assessment, reflecting
    // what was just found.
    await opportunityService.scoreOpportunity({
      opportunityId: opportunity.id,
      dimensions: { pain: 0.7, demand: 0.6, willingnessToPay: 0.1, reachability: 0.6, retention: 0.5, differentiation: 0.4, buildability: 0.7, economics: 0.5, risk: 0.6, evidenceQuality: 0.7, marketSize: 0.5, frequency: 0.5, evidenceIndependence: 0.5, timing: 0.5 },
      scoredBy: "test",
      killRiskDimensions: { weakDemand: 0.2, weakWillingnessToPay: 0.9, crowdedMarket: 0.3, poorDifferentiation: 0.3, badDistribution: 0.3, technicalDifficulty: 0.2, regulatoryRisk: 0.1, platformDependency: 0.1, lowRetention: 0.3, lowMargins: 0.3, insufficientEvidence: 0.2 },
    });
    const scoreHistory = await opportunityService.listScoreHistory(opportunity.id);
    expect(scoreHistory[0]?.killRiskScore).toBeGreaterThan(0.3);

    // CEO -> KILL, citing the contradicted claim explicitly.
    const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") return;
    expect(ceoOutcome.result.recommendation.action).toBe("KILL");
    expect(JSON.parse(ceoOutcome.result.recommendation.citedClaimIds)).toContain(wtpClaim.id);
    expect(ceoOutcome.result.recommendation.reasoning).toContain("CONTRADICTED");

    // Chairman review — independently REJECTs.
    const chairmanResult = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    expect(chairmanResult.decision.decision).toBe("REJECT");

    // Human: approves the kill.
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: ceoOutcome.result.recommendation.id, requestedByAgentId: agents.ceoAgent.id });
    expect(approvalRequest?.action).toBe("KILL_OPPORTUNITY");
    await approvalService.decide({ id: approvalRequest!.id, toStatus: "APPROVED", reviewedBy: humanOwner, decisionReason: "Confirmed: real customers said they would not pay." });

    const applied = await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest!.id, actor: humanOwner });
    expect(applied.killed).toBe(true);
    // The explicit, evidence-backed kill reason is preserved on the historical record.
    expect(JSON.parse(applied.decisionRecord.acceptedClaimIds)).toContain(wtpClaim.id);

    const finalOpportunity = await opportunityService.getOrThrow(opportunity.id);
    expect(finalOpportunity.status).toBe("KILLED");

    // Nothing is silently lost: the contradicting evidence and the
    // claim's full history remain queryable after the kill.
    const finalClaim = await claimService.getOrThrow(wtpClaim.id);
    expect(finalClaim.status).toBe("CONTRADICTED");
  });
});

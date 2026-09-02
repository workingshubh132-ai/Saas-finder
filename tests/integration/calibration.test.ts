import { describe, expect, it } from "vitest";
import { calibrationService } from "../../src/services/calibration.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { customerDiscoveryMemoRepository } from "../../src/db/repositories/customer-discovery-memo.repository.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

/**
 * Real opportunity/claim/ICP/experiment/CEO-recommendation/Chairman-review
 * chain (every foreign key is real), but the memo row itself is seeded
 * directly through the repository with a CHOSEN confidence/decision —
 * this file is testing calibrationService's own aggregation/filtering,
 * not customerDiscoveryMemoService.compile()'s content derivation
 * (already covered by tests/integration/customer-discovery-memo.test.ts).
 */
async function makeMemo(confidence: number, humanDecision: string | null) {
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
    objective: "test",
    researchQuestion: "test?",
    messageStrategy: "test",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "test",
    failureCriteria: "test",
  });

  const ceoOutcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (ceoOutcome.status !== "COMPLETED") throw new Error("recommendCustomerDiscoveryAction did not complete");
  const { review } = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

  const memo = await customerDiscoveryMemoRepository.create({
    opportunityId: opportunity.id,
    experimentId: experiment.id,
    ceoRecommendationId: ceoOutcome.result.recommendation.id,
    chairmanReviewId: review.id,
    content: "{}",
    claimsStrengthened: "[]",
    claimsWeakened: "[]",
    independentOrganizationCount: 0,
    responseCount: 0,
    recommendation: "test",
    confidence,
  });

  if (humanDecision !== null) {
    await customerDiscoveryMemoRepository.recordHumanDecision(memo.id, { humanDecision, humanReason: null, decidedByIdentityId: HUMAN_OWNER.actorId });
  }

  return memo;
}

describe("calibrationService.summarizeCustomerDiscovery", () => {
  it("buckets decided memos by confidence and computes the APPROVE rate per bucket — never M4's own \"APPROVED\" label", async () => {
    await makeMemo(0.85, "APPROVE");
    await makeMemo(0.9, "STOP");

    const summary = await calibrationService.summarizeCustomerDiscovery();
    const highBucket = summary.buckets.find((b) => b.range === "0.8-1.0")!;
    expect(highBucket.count).toBeGreaterThanOrEqual(2);
    expect(highBucket.approvedCount).toBeGreaterThanOrEqual(1);
  });

  it("excludes an undecided memo (humanDecision still null) from every bucket and from totalDecisions", async () => {
    const before = await calibrationService.summarizeCustomerDiscovery();
    await makeMemo(0.95, null);
    const after = await calibrationService.summarizeCustomerDiscovery();

    expect(after.totalDecisions).toBe(before.totalDecisions);
  });
});

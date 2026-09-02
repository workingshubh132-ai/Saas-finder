import { describe, expect, it } from "vitest";
import { icpProfileRepository } from "../../src/db/repositories/icp-profile.repository.js";
import { outreachMessageRepository } from "../../src/db/repositories/outreach-message.repository.js";
import { customerResponseRepository } from "../../src/db/repositories/customer-response.repository.js";
import { ceoRecommendationRepository } from "../../src/db/repositories/ceo-recommendation.repository.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { evidenceGapService } from "../../src/services/evidence-gap.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { claimService } from "../../src/services/claim.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";
import type { Claim } from "@prisma/client";

async function makeActiveExperiment(opportunityId: string, claim: Claim, agentId: string) {
  const icpProfile = await icpProfileRepository.create({
    opportunityId,
    industry: "Any",
    companySizeMin: null,
    companySizeMax: null,
    role: "Any",
    problemExposure: "Any",
    likelyFrequency: "Any",
    geography: "Any",
    technology: "Any",
    exclusions: "[]",
    fieldGrounding: "[]",
    generatedByAgentId: agentId,
  });
  const experiment = await outreachExperimentService.create({
    opportunityId,
    claimId: claim.id,
    targetIcpProfileId: icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: "test",
    researchQuestion: "test?",
    messageStrategy: "test",
    prospectLimit: 25,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "test",
    failureCriteria: "test",
  });
  await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });
  return experiment;
}

async function seedNegativeResponse(opportunityId: string, experimentId: string, claimId: string, organization: string, agentId: string) {
  const prospect = await makeProspect({ opportunityId, icpProfileId: null, organization });
  const message = await outreachMessageRepository.create({
    experimentId,
    prospectId: prospect.id,
    content: "test",
    reasoning: "test",
    claimBeingTestedId: claimId,
    expectedInformationGain: 0.5,
    draftedByAgentId: agentId,
  });
  const response = await customerResponseRepository.create({
    outreachMessageId: message.id,
    prospectId: prospect.id,
    rawContent: "We would never pay for this.",
    enteredByIdentityId: HUMAN_OWNER.actorId,
  });
  return customerResponseRepository.markAnalyzed(response.id, "NOT_INTERESTED");
}

describe("ceoReasoningService.recommendCustomerDiscoveryAction", () => {
  it("makes zero tool calls and stores into the same ceo_recommendations table CEO_DECISION_ACTIONS already uses", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    const outcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const rec = outcome.result.recommendation;
    expect(["RUN_CUSTOMER_DISCOVERY", "REFINE_ICP", "TEST_CLAIM", "STOP_EXPERIMENT", "REQUEST_HUMAN_REVIEW"]).toContain(rec.action);
    const stored = await ceoRecommendationRepository.findById(rec.id);
    expect(stored).not.toBeNull();
  });

  it("recommends RUN_CUSTOMER_DISCOVERY citing the highest-impact unresolved claim when no experiment exists yet", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    await evidenceGapService.analyzeClaim({ claim: wtpClaim, recommendedResearch: "Ask real prospects what they currently pay for a related workaround." });

    const outcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.recommendation.action).toBe("RUN_CUSTOMER_DISCOVERY");
    const citedClaimIds = JSON.parse(outcome.result.recommendation.citedClaimIds) as string[];
    expect(citedClaimIds).toContain(wtpClaim.id);
  });

  it("recommends REFINE_ICP when the CUSTOMER_SEGMENT claim is WEAK", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const segmentClaim = claims.find((c) => c.claimType === "CUSTOMER_SEGMENT")!;
    await claimService.setStatus({ id: segmentClaim.id, toStatus: "WEAK", confidence: 0.3, actorType: "SYSTEM", actorId: null });

    const outcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.recommendation.action).toBe("REFINE_ICP");
    const citedClaimIds = JSON.parse(outcome.result.recommendation.citedClaimIds) as string[];
    expect(citedClaimIds).toContain(segmentClaim.id);
  });

  it("recommends STOP_EXPERIMENT once enough independent negative responses have come in", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await makeActiveExperiment(opportunity.id, wtpClaim, agents.messageDrafterAgent.id);

    for (const org of ["Org A", "Org B", "Org C"]) {
      await seedNegativeResponse(opportunity.id, experiment.id, wtpClaim.id, org, agents.messageDrafterAgent.id);
    }

    const outcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.recommendation.action).toBe("STOP_EXPERIMENT");
  });

  it("does NOT recommend STOP_EXPERIMENT when negative responses all come from the SAME organization — not independent enough", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await makeActiveExperiment(opportunity.id, wtpClaim, agents.messageDrafterAgent.id);

    for (let i = 0; i < 3; i += 1) {
      await seedNegativeResponse(opportunity.id, experiment.id, wtpClaim.id, "Same Org", agents.messageDrafterAgent.id);
    }

    const outcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.recommendation.action).not.toBe("STOP_EXPERIMENT");
  });
});

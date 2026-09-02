import { describe, expect, it } from "vitest";
import { icpProfileRepository } from "../../src/db/repositories/icp-profile.repository.js";
import { outreachMessageRepository } from "../../src/db/repositories/outreach-message.repository.js";
import { customerResponseRepository } from "../../src/db/repositories/customer-response.repository.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
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

async function seedResponse(opportunityId: string, experimentId: string, claimId: string, organization: string, agentId: string, classification: string) {
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
    rawContent: "test response",
    enteredByIdentityId: HUMAN_OWNER.actorId,
  });
  return customerResponseRepository.markAnalyzed(response.id, classification);
}

describe("chairmanService.review — customer discovery (docs/M5_ARCHITECTURE_PROPOSAL.md §21)", () => {
  it("flags multiple responses concentrated in a single organization as weak corroboration", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await makeActiveExperiment(opportunity.id, wtpClaim, agents.messageDrafterAgent.id);

    await seedResponse(opportunity.id, experiment.id, wtpClaim.id, "Same Co", agents.messageDrafterAgent.id, "POSITIVE_SIGNAL");
    await seedResponse(opportunity.id, experiment.id, wtpClaim.id, "Same Co", agents.messageDrafterAgent.id, "POSITIVE_SIGNAL");

    const { decision } = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(decision.objections.some((o) => /independent organization/i.test(o))).toBe(true);
  });

  it("flags unaddressed negative/NOT_INTERESTED responses when no CEO recommendation accounts for them", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await makeActiveExperiment(opportunity.id, wtpClaim, agents.messageDrafterAgent.id);

    await seedResponse(opportunity.id, experiment.id, wtpClaim.id, "Org One", agents.messageDrafterAgent.id, "NOT_INTERESTED");

    const { decision } = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(decision.objections.some((o) => /negative.*NOT_INTERESTED response/i.test(o) || /negative\/NOT_INTERESTED/i.test(o))).toBe(true);
  });

  it("does not flag independence when responses come from genuinely different organizations", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const experiment = await makeActiveExperiment(opportunity.id, wtpClaim, agents.messageDrafterAgent.id);

    await seedResponse(opportunity.id, experiment.id, wtpClaim.id, "Org A", agents.messageDrafterAgent.id, "POSITIVE_SIGNAL");
    await seedResponse(opportunity.id, experiment.id, wtpClaim.id, "Org B", agents.messageDrafterAgent.id, "POSITIVE_SIGNAL");

    const { decision } = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(decision.objections.some((o) => /independent organization is represented/i.test(o))).toBe(false);
  });
});

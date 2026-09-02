import { describe, expect, it } from "vitest";
import { outreachMessageRepository } from "../../src/db/repositories/outreach-message.repository.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { prospectService } from "../../src/services/prospect.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

async function makeActiveExperimentWithQualifiedProspect() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");
  const icpProfile = icpOutcome.result.icpProfile;

  const experiment = await outreachExperimentService.create({
    opportunityId: opportunity.id,
    claimId: claim.id,
    targetIcpProfileId: icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: "Confirm willingness to pay.",
    researchQuestion: "How much do you currently spend solving this problem, if anything?",
    messageStrategy: "Ask about current process and spend — learning, not selling.",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "At least 3 independent organizations describe real current spending.",
    failureCriteria: "Fewer than 2 responses after 10 contacted.",
  });
  await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

  const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, organization: "Acme Co", role: "Small business owner" });
  await prospectService.setQualification(
    prospect.id,
    "QUALIFIED",
    { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "Role matches ICP.", unknowns: "[]" },
    { actorType: "SYSTEM", actorId: null },
  );

  return { agents, opportunity, experiment, prospect, icpProfile };
}

describe("messageDrafterService.run", () => {
  it("drafts a message grounded in the real experiment/prospect input, moving the prospect to DRAFT_READY", async () => {
    const { agents, experiment, prospect } = await makeActiveExperimentWithQualifiedProspect();

    const outcome = await messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const { message } = outcome.result;
    expect(message.status).toBe("DRAFT");
    expect(message.content).toContain(experiment.researchQuestion);
    expect(message.claimBeingTestedId).toBe(experiment.claimId);
    expect(typeof message.expectedInformationGain).toBe("number");

    const updatedProspect = await prospectService.getOrThrow(prospect.id);
    expect(updatedProspect.status).toBe("DRAFT_READY");
  });

  it("refuses to draft under an experiment that is not yet ACTIVE", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");

    const pendingExperiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpOutcome.result.icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      objective: "Confirm willingness to pay.",
      researchQuestion: "How much do you spend today?",
      messageStrategy: "Learning, not selling.",
      prospectLimit: 10,
      timeWindowStart: null,
      timeWindowEnd: null,
      successCriteria: "3+ responses.",
      failureCriteria: "Fewer than 2.",
    });
    // Never approved — still PENDING_APPROVAL.
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpOutcome.result.icpProfile.id });
    await prospectService.setQualification(
      prospect.id,
      "QUALIFIED",
      { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "x", unknowns: "[]" },
      { actorType: "SYSTEM", actorId: null },
    );

    await expect(
      messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: pendingExperiment.id, prospectId: prospect.id, startedBy: authActor() }),
    ).rejects.toThrow(/not ACTIVE/i);
  });

  it("refuses to draft for a prospect that is not QUALIFIED", async () => {
    const { agents, experiment, opportunity, icpProfile } = await makeActiveExperimentWithQualifiedProspect();
    const unqualified = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id }); // still DISCOVERED

    await expect(
      messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: unqualified.id, startedBy: authActor() }),
    ).rejects.toThrow(/not QUALIFIED/i);
  });

  it("enforces the per-experiment daily message limit", async () => {
    const { agents, experiment, prospect } = await makeActiveExperimentWithQualifiedProspect();
    // Seed 10 already-drafted messages today, bypassing the full drafter flow purely to test the counting/enforcement boundary cheaply.
    for (let i = 0; i < 10; i += 1) {
      await outreachMessageRepository.create({
        experimentId: experiment.id,
        prospectId: prospect.id,
        content: `Seed message ${i}`,
        reasoning: "Seeded directly for the rate-limit test.",
        claimBeingTestedId: experiment.claimId,
        expectedInformationGain: 0.5,
        draftedByAgentId: agents.messageDrafterAgent.id,
      });
    }

    await expect(
      messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() }),
    ).rejects.toThrow(/already drafted 10 message/i);
  });

  it("enforces the per-destination-channel daily message limit", async () => {
    const { agents, experiment, opportunity, icpProfile } = await makeActiveExperimentWithQualifiedProspect();
    const sharedChannel = "https://dev-fixture.local/shared-channel";
    const seedProspect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, publicContactChannel: sharedChannel, sourceUrl: sharedChannel });
    for (let i = 0; i < 5; i += 1) {
      await outreachMessageRepository.create({
        experimentId: experiment.id,
        prospectId: seedProspect.id,
        content: `Seed message ${i}`,
        reasoning: "Seeded directly for the rate-limit test.",
        claimBeingTestedId: experiment.claimId,
        expectedInformationGain: 0.5,
        draftedByAgentId: agents.messageDrafterAgent.id,
      });
    }

    const secondProspectSameChannel = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, publicContactChannel: sharedChannel, sourceUrl: `${sharedChannel}-2` });
    await prospectService.setQualification(
      secondProspectSameChannel.id,
      "QUALIFIED",
      { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "x", unknowns: "[]" },
      { actorType: "SYSTEM", actorId: null },
    );

    await expect(
      messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: secondProspectSameChannel.id, startedBy: authActor() }),
    ).rejects.toThrow(/already received 5 message/i);
  });
});

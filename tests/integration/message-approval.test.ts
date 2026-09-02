import { describe, expect, it } from "vitest";
import { approvalService } from "../../src/services/approval.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { prospectService } from "../../src/services/prospect.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

async function makeDraftedMessage() {
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
    messageStrategy: "Learning, not selling.",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "3+ responses.",
    failureCriteria: "Fewer than 2.",
  });
  await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

  const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id });
  await prospectService.setQualification(
    prospect.id,
    "QUALIFIED",
    { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "x", unknowns: "[]" },
    { actorType: "SYSTEM", actorId: null },
  );

  const draftOutcome = await messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() });
  if (draftOutcome.status !== "COMPLETED") throw new Error("messageDrafterService.run did not complete");

  return { agents, experiment, prospect, message: draftOutcome.result.message };
}

describe("the full message approval gate", () => {
  it("takes a drafted message all the way to CONTACTED through both explicit human decisions", async () => {
    const { agents, message } = await makeDraftedMessage();

    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    expect(approvalRequest.riskLevel).toBe("RED");
    expect(approvalRequest.resourceType).toBe("OUTREACH_MESSAGE");
    expect(approvalRequest.resourceId).toBe(message.id);

    const decided = await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    expect(decided.status).toBe("APPROVED");

    const applied = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    expect(applied.status).toBe("APPROVED_TO_CONTACT");

    const contacted = await messageApprovalService.markContacted({ outreachMessageId: message.id, actor: HUMAN_OWNER });
    expect(contacted.status).toBe("CONTACTED");
    expect(contacted.contactedByIdentityId).toBe(HUMAN_OWNER.actorId);
    expect(contacted.contactedAt).not.toBeNull();

    const prospect = await prospectService.getOrThrow(message.prospectId);
    expect(prospect.status).toBe("CONTACTED");
  });

  it("takes a rejected message to REJECTED on both the message and the prospect — never to CONTACTED", async () => {
    const { agents, message } = await makeDraftedMessage();

    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "REJECTED", reviewedBy: HUMAN_OWNER, decisionReason: "Message tone needs work." });

    const applied = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    expect(applied.status).toBe("REJECTED");

    await expect(messageApprovalService.markContacted({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/not APPROVED_TO_CONTACT/i);

    const prospect = await prospectService.getOrThrow(message.prospectId);
    expect(prospect.status).toBe("REJECTED");
  });

  it("refuses markContacted before the message has been approved", async () => {
    const { message } = await makeDraftedMessage();
    await expect(messageApprovalService.markContacted({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/not APPROVED_TO_CONTACT/i);
  });

  it("refuses markContacted for a non-human actor", async () => {
    const { agents, message } = await makeDraftedMessage();
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });

    await expect(messageApprovalService.markContacted({ outreachMessageId: message.id, actor: { actorType: "AGENT", actorId: agents.messageDrafterAgent.id } })).rejects.toThrow();
  });

  it("is idempotent — applying the same decision twice never double-transitions or throws", async () => {
    const { agents, message } = await makeDraftedMessage();
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    const first = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    const second = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    expect(first.status).toBe("APPROVED_TO_CONTACT");
    expect(second.status).toBe("APPROVED_TO_CONTACT");
  });

  it("refuses to request approval twice for the same message", async () => {
    const { agents, message } = await makeDraftedMessage();
    await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });

    await expect(messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id })).rejects.toThrow(/not DRAFT/i);
  });

  it("binds approval to the exact message — the agent that drafted the message cannot approve its own request (self-approval prevention)", async () => {
    const { agents, message } = await makeDraftedMessage();
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });

    await expect(approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: { actorType: "AGENT", actorId: agents.messageDrafterAgent.id } })).rejects.toThrow();
  });
});

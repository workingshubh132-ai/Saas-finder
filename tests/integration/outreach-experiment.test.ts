import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

async function makeReadyOpportunity() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");
  const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
  return { opportunity, claim, icpProfile: icpOutcome.result.icpProfile };
}

const BASE_EXPERIMENT_FIELDS = {
  objective: "Confirm willingness to pay for the core workflow.",
  researchQuestion: "How much do you currently spend solving this problem, if anything?",
  messageStrategy: "Ask about their current process and spend — learning, not selling.",
  prospectLimit: 10,
  timeWindowStart: null,
  timeWindowEnd: null,
  successCriteria: "At least 3 independent organizations describe real current spending.",
  failureCriteria: "Fewer than 2 responses after 10 contacted, or explicit 'would never pay' from a majority.",
};

describe("outreachExperimentService.create", () => {
  it("creates a PENDING_APPROVAL experiment defaulting to HUMAN_APPROVAL_REQUIRED contact policy", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();

    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    expect(experiment.status).toBe("PENDING_APPROVAL");
    expect(experiment.contactPolicy).toBe("HUMAN_APPROVAL_REQUIRED");
  });

  it("rejects an ICP profile that belongs to a different opportunity — never let one experiment cross-contaminate another opportunity's targeting", async () => {
    const { icpProfile } = await makeReadyOpportunity();
    const other = await makeReadyOpportunity();

    await expect(
      outreachExperimentService.create({
        opportunityId: other.opportunity.id,
        claimId: other.claim.id,
        targetIcpProfileId: icpProfile.id, // belongs to the FIRST opportunity, not `other`
        createdByIdentityId: HUMAN_OWNER.actorId,
        ...BASE_EXPERIMENT_FIELDS,
      }),
    ).rejects.toThrow(/different opportunity/i);
  });

  it("rejects a prospectLimit above the configured maximum", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();

    await expect(
      outreachExperimentService.create({
        opportunityId: opportunity.id,
        claimId: claim.id,
        targetIcpProfileId: icpProfile.id,
        createdByIdentityId: HUMAN_OWNER.actorId,
        ...BASE_EXPERIMENT_FIELDS,
        prospectLimit: 999,
      }),
    ).rejects.toThrow(/exceeds the maximum/i);
  });
});

describe("outreachExperimentService.approve", () => {
  it("is denied to a non-human actor", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();
    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    await expect(outreachExperimentService.approve({ id: experiment.id, actor: { actorType: "AGENT", actorId: "some-agent" } })).rejects.toThrow();
  });

  it("moves PENDING_APPROVAL -> ACTIVE for a verified human actor", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();
    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    const approved = await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

    expect(approved.status).toBe("ACTIVE");
    expect(approved.approvedByIdentityId).toBe(HUMAN_OWNER.actorId);
    expect(approved.approvedAt).not.toBeNull();
  });

  it("enforces the maximum number of simultaneously ACTIVE experiments per opportunity", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();

    for (let i = 0; i < 3; i += 1) {
      const experiment = await outreachExperimentService.create({
        opportunityId: opportunity.id,
        claimId: claim.id,
        targetIcpProfileId: icpProfile.id,
        createdByIdentityId: HUMAN_OWNER.actorId,
        ...BASE_EXPERIMENT_FIELDS,
      });
      await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });
    }

    const fourth = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    await expect(outreachExperimentService.approve({ id: fourth.id, actor: HUMAN_OWNER })).rejects.toThrow(/already has 3 ACTIVE/i);
  });
});

describe("outreachExperimentService.setStatus", () => {
  it("rejects an illegal transition (PENDING_APPROVAL -> COMPLETED)", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();
    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    await expect(outreachExperimentService.setStatus({ id: experiment.id, toStatus: "COMPLETED", reason: null, actorType: "SYSTEM", actorId: null })).rejects.toThrow();
  });

  it("allows PENDING_APPROVAL -> CANCELLED", async () => {
    const { opportunity, claim, icpProfile } = await makeReadyOpportunity();
    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });

    const cancelled = await outreachExperimentService.setStatus({ id: experiment.id, toStatus: "CANCELLED", reason: "Founder decided not to pursue.", actorType: "HUMAN", actorId: HUMAN_OWNER.actorId });
    expect(cancelled.status).toBe("CANCELLED");
  });
});

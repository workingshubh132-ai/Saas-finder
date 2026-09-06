import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { discoveryExperimentService } from "../../src/services/discovery-experiment.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { NotFoundError, ValidationError } from "../../src/domain/shared/errors.js";
import { authActor, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

const BASE_EXPERIMENT_FIELDS = {
  objective: "Confirm real workflow exposure to the validated problem.",
  researchQuestion: "How do you currently handle this workflow?",
  messageStrategy: "Ask one workflow question — learning, never selling.",
  prospectLimit: 25,
  timeWindowStart: null,
  timeWindowEnd: null,
  successCriteria: "At least one real business describes the workflow in its own words.",
  failureCriteria: "No responses after 10 contacted.",
};

async function makeActiveExperiment() {
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

  const icpOutcome = await icpAnalystService.run({ agentId: (await makeAnyAgent()).id, opportunityId: opportunity.id, startedBy: authActor() });
  if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");

  const experiment = await outreachExperimentService.create({
    opportunityId: opportunity.id,
    claimId: claim.id,
    targetIcpProfileId: icpOutcome.result.icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    ...BASE_EXPERIMENT_FIELDS,
  });
  const approved = await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

  return { opportunity, experiment: approved };
}

async function makeAnyAgent() {
  const { agentService } = await import("../../src/services/agent.service.js");
  return agentService.createAgent({
    name: `Test setup agent ${Math.random()}`,
    role: "Researcher",
    department: "INTELLIGENCE",
    description: "Test-only setup agent.",
    riskLevel: "GREEN",
    createdBy: HUMAN_OWNER,
  });
}

describe("discoveryExperimentService.run — end-to-end vertical slice", () => {
  it("A. runs the full slice and never sends anything — messagesSent is always 0", async () => {
    const { opportunity, experiment } = await makeActiveExperiment();

    const report = await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });

    expect(report.messagesSent).toBe(0);
    expect(report.opportunityId).toBe(opportunity.id);
    expect(report.experimentId).toBe(experiment.id);
    expect(report.prospectsDiscovered).toBeGreaterThan(0);
    expect(report.qualifiedCandidates.length + report.rejectedCandidates.length).toBe(report.prospectsDiscovered);

    const deliveries = await prisma.outreachMessageDelivery.count();
    expect(deliveries).toBe(0);
  });

  it("B. every reported candidate carries provenance, REAL/DEV_FIXTURE status, and a public contact channel — never fabricated", async () => {
    const { opportunity, experiment } = await makeActiveExperiment();
    const report = await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });

    for (const candidate of [...report.qualifiedCandidates, ...report.rejectedCandidates]) {
      expect(candidate.publicContactChannel).toBeTruthy();
      expect(candidate.reality).toBe("DEV_FIXTURE"); // no RESEARCH_TOOL_MODE=live configured in this environment — honestly reported, never silently REAL.
      expect(candidate.provenanceNote).toBeTruthy();
      expect(candidate.opportunityId).toBe(opportunity.id);
    }
  });

  it("C. qualified candidates with a draft get exactly one ApprovalRequest each — approvalsRequired matches", async () => {
    const { opportunity, experiment } = await makeActiveExperiment();
    const report = await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });

    const withApproval = report.qualifiedCandidates.filter((c) => c.approvalRequestId !== null);
    expect(withApproval.length).toBe(report.approvalsRequired);
    expect(report.outreachDraftsCreated).toBe(withApproval.length);

    for (const c of withApproval) {
      const approvalRequest = await prisma.approvalRequest.findUnique({ where: { id: c.approvalRequestId! } });
      expect(approvalRequest).not.toBeNull();
      expect(approvalRequest!.status).toBe("PENDING"); // never auto-approved.
      expect(approvalRequest!.resourceId).toBe(c.outreachMessageId);
    }
  });

  it("D. is idempotent — running twice against the same opportunity/experiment discovers zero new prospects the second time", async () => {
    const { opportunity, experiment } = await makeActiveExperiment();
    const first = await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });
    expect(first.prospectsDiscovered).toBeGreaterThan(0);

    const second = await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });
    expect(second.prospectsDiscovered).toBe(0);
    expect(second.messagesSent).toBe(0);
  });

  it("E. refuses to run against an experiment that is not ACTIVE — never auto-approves it", async () => {
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const icpOutcome = await icpAnalystService.run({ agentId: (await makeAnyAgent()).id, opportunityId: opportunity.id, startedBy: authActor() });
    if (icpOutcome.status !== "COMPLETED") throw new Error("setup failed");

    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpOutcome.result.icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      ...BASE_EXPERIMENT_FIELDS,
    });
    // Deliberately NOT approved — still PENDING_APPROVAL.

    await expect(discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 })).rejects.toThrow(ValidationError);

    const stillPending = await prisma.outreachExperiment.findUnique({ where: { id: experiment.id } });
    expect(stillPending!.status).toBe("PENDING_APPROVAL");
  });

  it("F. refuses an experiment belonging to a different opportunity", async () => {
    const { experiment } = await makeActiveExperiment();
    const otherOpportunity = await makeOpportunity();

    await expect(discoveryExperimentService.run({ opportunityId: otherOpportunity.id, experimentId: experiment.id, targetCount: 5 })).rejects.toThrow(ValidationError);
  });

  it("G. throws NotFoundError for an unknown opportunity or experiment", async () => {
    await expect(discoveryExperimentService.run({ opportunityId: "does-not-exist", experimentId: "does-not-exist", targetCount: 5 })).rejects.toThrow(NotFoundError);
  });

  it("H. real audit trail — an AgentExecution exists for every step the orchestration actually ran", async () => {
    const { opportunity, experiment } = await makeActiveExperiment();
    const before = await prisma.agentExecution.count();

    await discoveryExperimentService.run({ opportunityId: opportunity.id, experimentId: experiment.id, targetCount: 5 });

    const after = await prisma.agentExecution.count();
    expect(after).toBeGreaterThan(before); // real executions were recorded, not a silent bypass.
  });
});

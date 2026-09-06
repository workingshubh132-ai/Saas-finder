import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import type { EvidenceTargetingSignal } from "../../src/domain/icp-profile/targeting-signal.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { opportunityAnalystService } from "../../src/services/opportunity-analyst.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { problemAnalystService } from "../../src/services/problem-analyst.service.js";
import { prospectQualificationService } from "../../src/services/prospect-qualification.service.js";
import { prospectService } from "../../src/services/prospect.service.js";
import { customerResponseService } from "../../src/services/customer-response.service.js";
import { responseAnalystService } from "../../src/services/response-analyst.service.js";
import { signalClusteringService } from "../../src/services/signal-clustering.service.js";
import { signalService } from "../../src/services/signal.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { NotHumanOwnerError } from "../../src/domain/shared/errors.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { authActor, makeAgent, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

/** Real-shaped signal content mentioning a named platform ("Xero") and the reconciliation workflow — mirrors the actual payment-reconciliation Problem this fix was built against, generalized so it isn't hardcoded to that one opportunity. */
function raw(index: number, mentionsXero: boolean): RawSourceResult {
  const core = mentionsXero
    ? "Xero users report bank payments do not reliably match invoices for customers during reconciliation"
    : "small business owners spend hours every month reconciling invoices manually across tools";
  const filler = `topicfiller${index}a topicfiller${index}b topicfiller${index}c topicfiller${index}d topicfiller${index}e`;
  return {
    title: "Payment reconciliation is unreliable",
    content: `${core} ${filler}`,
    url: `https://example.com/thread/${index}`,
    publishedAt: "2026-08-20T00:00:00Z",
    authorContext: `user${index}`,
    sourceGroupKey: null,
    metadata: {},
  };
}

async function makeRealEvidenceOpportunity() {
  const collectingAgent = await makeAgent();
  let clusterId = "";
  for (let i = 0; i < 2; i += 1) {
    const signal = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(i, true), collectedByAgentId: collectingAgent.id });
    const cluster = await signalClusteringService.assign(signal.id);
    clusterId = cluster.id;
  }

  const problemAgent = await makeAgent({ role: "Problem Analyst" });
  const problemOutcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId, startedBy: authActor() });
  if (problemOutcome.status !== "COMPLETED" || problemOutcome.result.problem.status !== "CANDIDATE") {
    throw new Error("setup failed: problem did not reach CANDIDATE");
  }

  const opportunityAgent = await makeAgent({ role: "Opportunity Analyst" });
  const opportunityOutcome = await opportunityAnalystService.run({
    agentId: opportunityAgent.id,
    problemId: problemOutcome.result.problem.id,
    marketAnalysis: { wtpSignals: [], marketTiming: "unclear", marketSizeQualitative: "unclear" },
    startedBy: authActor(),
  });
  if (opportunityOutcome.status !== "COMPLETED") throw new Error("setup failed: opportunity not created");

  return opportunityOutcome.result.opportunity;
}

describe("evidence-backed ICP targeting signals", () => {
  it("1. evidence-backed technology signals reach the ICP's own technology field instead of the thin default", async () => {
    const opportunity = await makeRealEvidenceOpportunity();
    const agents = await makeFullAgentSet();

    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const { icpProfile } = outcome.result;
    expect(icpProfile.technology).not.toBe("Any — not evidenced");
    expect(icpProfile.technology).toContain("Accounting/bookkeeping");

    const signals = JSON.parse(icpProfile.evidenceTargetingSignals ?? "[]") as EvidenceTargetingSignal[];
    expect(signals.length).toBeGreaterThan(0);
    const platformSignal = signals.find((s) => s.category === "PLATFORM" && s.label === "Xero");
    expect(platformSignal?.provenance).toBe("EVIDENCED");
  });

  it("2/3. platform-specific evidence generalizes as INFERRED (not EVIDENCED), and every grounded id is a real, existing Evidence row — provenance is traceable, not asserted", async () => {
    const opportunity = await makeRealEvidenceOpportunity();
    const agents = await makeFullAgentSet();

    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const { icpProfile } = outcome.result;
    const grounding = JSON.parse(icpProfile.fieldGrounding) as Array<{ field: string; status: string; groundedInEvidenceIds?: string[] }>;
    const technologyGrounding = grounding.find((g) => g.field === "technology")!;
    expect(technologyGrounding.status).toBe("INFERRED"); // generalized from the one named platform (Xero) — only one platform was ever mentioned here
    expect(technologyGrounding.groundedInEvidenceIds?.length).toBeGreaterThan(0);

    for (const evidenceId of technologyGrounding.groundedInEvidenceIds ?? []) {
      const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
      expect(evidence).not.toBeNull(); // a real, dereferenceable Evidence row, never a fabricated id
    }
  });

  it("5. an opportunity whose evidence matches no known vocabulary keeps the ICP's technology field honestly ASSUMED — never spuriously enriched", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const { icpProfile } = outcome.result;
    expect(icpProfile.technology).toBe("Any — not evidenced");
    expect(icpProfile.evidenceTargetingSignals).toBeNull();

    const grounding = JSON.parse(icpProfile.fieldGrounding) as Array<{ field: string; status: string }>;
    expect(grounding.find((g) => g.field === "technology")!.status).toBe("ASSUMED");
  });

  it("6. prospect qualification uses an evidence-backed signal as an independent path, but never qualifies a prospect with no overlap at all", async () => {
    const opportunity = await makeRealEvidenceOpportunity();
    const agents = await makeFullAgentSet();
    const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    if (icpOutcome.status !== "COMPLETED") throw new Error("setup failed");
    const icpProfile = icpOutcome.result.icpProfile;

    const matchingProspect = await makeProspect({
      opportunityId: opportunity.id,
      icpProfileId: icpProfile.id,
      organization: "Riverside Bookkeeping (Xero Certified Partner)",
      role: "Owner",
    });
    const matchingOutcome = await prospectQualificationService.run({ agentId: agents.icpAnalystAgent.id, prospectId: matchingProspect.id, startedBy: authActor() });
    expect(matchingOutcome.status).toBe("COMPLETED");
    if (matchingOutcome.status === "COMPLETED") {
      expect(matchingOutcome.result.prospect.qualificationStatus).toBe("QUALIFIED");
      expect(matchingOutcome.result.prospect.reasonForMatch).toContain("Xero");
    }

    const unrelatedProspect = await makeProspect({
      opportunityId: opportunity.id,
      icpProfileId: icpProfile.id,
      organization: "Downtown Pet Grooming",
      role: "Groomer",
    });
    const unrelatedOutcome = await prospectQualificationService.run({ agentId: agents.icpAnalystAgent.id, prospectId: unrelatedProspect.id, startedBy: authActor() });
    expect(unrelatedOutcome.status).toBe("COMPLETED");
    if (unrelatedOutcome.status === "COMPLETED") {
      expect(unrelatedOutcome.result.prospect.qualificationStatus).not.toBe("QUALIFIED");
    }
  });

  it("9. approve() still requires a verified human actor — evaluateDiscoveryOutcome does not weaken the existing gate", async () => {
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const agents = await makeFullAgentSet();
    const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    if (icpOutcome.status !== "COMPLETED") throw new Error("setup failed");

    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpOutcome.result.icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      objective: "test",
      researchQuestion: "test",
      messageStrategy: "test",
      prospectLimit: 10,
      timeWindowStart: null,
      timeWindowEnd: null,
      successCriteria: "test",
      failureCriteria: "test",
    });
    expect(experiment.status).toBe("PENDING_APPROVAL");

    await expect(outreachExperimentService.approve({ id: experiment.id, actor: { actorType: "AGENT", actorId: agents.icpAnalystAgent.id } })).rejects.toThrow(NotHumanOwnerError);

    const assessment = await outreachExperimentService.evaluateDiscoveryOutcome(experiment.id);
    expect(assessment.outcome).toBe("NO_RESPONSE"); // zero responses so far — reported honestly, not as disconfirmation
  });

  it("7/8/10. a real pain response becomes PROBLEM_PRESENT via the existing, unmodified customer-discovery path — and no outbound message is ever sent", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    if (icpOutcome.status !== "COMPLETED") throw new Error("setup failed");

    const experiment = await outreachExperimentService.create({
      opportunityId: opportunity.id,
      claimId: claim.id,
      targetIcpProfileId: icpOutcome.result.icpProfile.id,
      createdByIdentityId: HUMAN_OWNER.actorId,
      objective: "test",
      researchQuestion: "How do you currently reconcile payments, and how often does it go wrong?",
      messageStrategy: "Learning, not selling.",
      prospectLimit: 10,
      timeWindowStart: null,
      timeWindowEnd: null,
      successCriteria: "test",
      failureCriteria: "test",
    });
    await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

    const preExperimentOutcome = await outreachExperimentService.evaluateDiscoveryOutcome(experiment.id);
    expect(preExperimentOutcome.outcome).toBe("NO_RESPONSE"); // before any prospect/message/response exists at all

    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpOutcome.result.icpProfile.id });
    await prospectService.setQualification(
      prospect.id,
      "QUALIFIED",
      { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "x", unknowns: "[]" },
      { actorType: "SYSTEM", actorId: null },
    );

    const draft = await messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() });
    if (draft.status !== "COMPLETED") throw new Error("setup failed: draft");
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: draft.result.message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    await messageApprovalService.markContacted({ outreachMessageId: draft.result.message.id, actor: HUMAN_OWNER });

    const response = await customerResponseService.record({
      outreachMessageId: draft.result.message.id,
      rawContent: "We manually reconcile our books every week and it's frustrating — hours of work with no automation.",
      actor: HUMAN_OWNER,
    });
    const analysisOutcome = await responseAnalystService.run({ agentId: agents.responseAnalystAgent.id, customerResponseId: response.id, startedBy: authActor() });
    expect(analysisOutcome.status).toBe("COMPLETED");
    if (analysisOutcome.status === "COMPLETED") {
      expect(analysisOutcome.result.evidenceCount).toBeGreaterThan(0); // real Evidence/CustomerEvidence created via the existing, unmodified pipeline
    }

    const postResponseOutcome = await outreachExperimentService.evaluateDiscoveryOutcome(experiment.id);
    expect(postResponseOutcome.outcome).toBe("PROBLEM_PRESENT");
    expect(postResponseOutcome.analyzedResponses).toBe(1);

    const deliveries = await prisma.outreachMessageDelivery.count();
    expect(deliveries).toBe(0); // "contacted" here means a human recorded it happened outside the system — never an automated send
  });
});

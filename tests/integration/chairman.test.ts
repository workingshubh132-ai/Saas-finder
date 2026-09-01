import { describe, expect, it } from "vitest";
import { chairmanService } from "../../src/services/chairman.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

function authActor() {
  return { type: "HUMAN" as const, id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId };
}

async function makeOpportunity() {
  const agent = await makeAgent();
  const opportunity = await opportunityService.createOpportunity({
    title: "Test opportunity",
    problem: "p",
    targetCustomer: "t",
    description: "d",
    discoveredBy: { actorType: "AGENT", actorId: agent.id },
  });
  return { agent, opportunity };
}

describe("chairmanService", () => {
  it("reviews an opportunity and always produces at least one objection — never a silent rubber stamp", async () => {
    const { agent, opportunity } = await makeOpportunity();
    const evidence = await evidenceService.collectEvidence({
      claim: "3 of 5 founders mentioned this pain",
      source: "interviews",
      sourceType: "CUSTOMER",
      reliability: "HIGH",
      confidence: 0.85,
      collectedByAgentId: agent.id,
    });
    await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: evidence.id, actor: { actorType: "AGENT", actorId: agent.id } });
    await opportunityService.scoreOpportunity({
      opportunityId: opportunity.id,
      scoredBy: agent.id,
      dimensions: {
        pain: 0.8,
        demand: 0.8,
        willingnessToPay: 0.7,
        reachability: 0.6,
        retention: 0.6,
        differentiation: 0.5,
        buildability: 0.7,
        economics: 0.6,
        risk: 0.2,
        evidenceQuality: 0.85,
        marketSize: 0.6,
        frequency: 0.6,
        evidenceIndependence: 0.5,
        timing: 0.5,
      },
    });

    const result = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(result.decision.objections.length).toBeGreaterThan(0);
    expect(result.review.opportunityId).toBe(opportunity.id);
  });

  it("identifies missing evidence and recommends REQUEST_MORE_EVIDENCE for a weak opportunity", async () => {
    const { opportunity } = await makeOpportunity(); // zero evidence, unscored

    const result = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(result.decision.decision).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.decision.missingEvidence.length).toBeGreaterThan(0);
  });

  it("can approve a strong, well-evidenced opportunity — but different opportunities get genuinely different reviews", async () => {
    const { agent, opportunity: weak } = await makeOpportunity();
    const weakReview = await chairmanService.review({ opportunityId: weak.id, reviewedBy: authActor() });

    const strong = await opportunityService.createOpportunity({
      title: "Strong opportunity",
      problem: "p",
      targetCustomer: "t",
      description: "d",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });
    for (let i = 0; i < 3; i += 1) {
      const evidence = await evidenceService.collectEvidence({
        claim: `Strong claim ${i}`,
        source: "interview",
        sourceType: "CUSTOMER",
        reliability: "HIGH",
        confidence: 0.9,
        collectedByAgentId: agent.id,
      });
      await opportunityService.attachEvidence({ opportunityId: strong.id, evidenceId: evidence.id, actor: { actorType: "AGENT", actorId: agent.id } });
    }
    await opportunityService.scoreOpportunity({
      opportunityId: strong.id,
      scoredBy: agent.id,
      dimensions: {
        pain: 0.9,
        demand: 0.9,
        willingnessToPay: 0.9,
        reachability: 0.8,
        retention: 0.8,
        differentiation: 0.7,
        buildability: 0.8,
        economics: 0.8,
        risk: 0.1,
        evidenceQuality: 0.9,
        marketSize: 0.8,
        frequency: 0.8,
        evidenceIndependence: 0.7,
        timing: 0.7,
      },
    });

    const strongReview = await chairmanService.review({ opportunityId: strong.id, reviewedBy: authActor() });

    expect(strongReview.decision.decision).toBe("APPROVE");
    expect(strongReview.decision.decision).not.toBe(weakReview.decision.decision);
    expect(strongReview.decision.reasoning).not.toBe(weakReview.decision.reasoning);
  });

  it("persists every review and getLatestReview/listReviews return them", async () => {
    const { opportunity } = await makeOpportunity();
    await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    const all = await chairmanService.listReviews(opportunity.id);
    expect(all).toHaveLength(2);
    const latest = await chairmanService.getLatestReview(opportunity.id);
    expect(latest?.id).toBe(all[0]?.id); // listReviews orders newest first
  });

  it("cannot override the Human Owner — reviewing an opportunity never changes any ApprovalRequest", async () => {
    const { agent, opportunity } = await makeOpportunity();
    const request = await approvalService.requestApproval({
      requestedByAgentId: agent.id,
      action: "ADVANCE_TO_VALIDATION",
      description: "test",
      riskLevel: "YELLOW",
      resourceType: "OPPORTUNITY",
      resourceId: opportunity.id,
    });
    expect(request.status).toBe("PENDING");

    await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    const afterReview = await approvalService.getOrThrow(request.id);
    expect(afterReview.status).toBe("PENDING"); // unchanged — only a Human decides
    expect(afterReview.reviewedBy).toBeNull();
  });
});

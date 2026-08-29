import { describe, expect, it } from "vitest";
import { InvalidTransitionError, ValidationError } from "../../src/domain/shared/errors.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

describe("evidenceService", () => {
  it("collects evidence attributed to an existing agent", async () => {
    const agent = await makeAgent();
    const evidence = await evidenceService.collectEvidence({
      claim: "3 of 5 interviewed founders said they'd pay $50/mo for this.",
      source: "Founder interviews, Aug 2026",
      sourceType: "CUSTOMER",
      reliability: "MEDIUM",
      confidence: 0.6,
      collectedByAgentId: agent.id,
    });

    expect(evidence.verificationStatus).toBe("UNVERIFIED");
    expect(evidence.confidence).toBe(0.6);
  });

  it("rejects confidence outside [0, 1]", async () => {
    const agent = await makeAgent();
    await expect(
      evidenceService.collectEvidence({
        claim: "x",
        source: "x",
        sourceType: "OTHER",
        reliability: "LOW",
        confidence: 1.2,
        collectedByAgentId: agent.id,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unsupported source type or reliability value", async () => {
    const agent = await makeAgent();
    await expect(
      evidenceService.collectEvidence({
        claim: "x",
        source: "x",
        sourceType: "RUMOR",
        reliability: "LOW",
        confidence: 0.5,
        collectedByAgentId: agent.id,
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      evidenceService.collectEvidence({
        claim: "x",
        source: "x",
        sourceType: "OTHER",
        reliability: "SUPER_HIGH",
        confidence: 0.5,
        collectedByAgentId: agent.id,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("can be attached to an opportunity and shows up in its evidence list", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "Invoice chasing for freelancers",
      problem: "Freelancers lose money to late payments",
      targetCustomer: "Solo freelancers",
      description: "Automated invoice follow-ups",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });
    const evidence = await evidenceService.collectEvidence({
      claim: "Late payments are a top-3 complaint in r/freelance",
      source: "Reddit thread analysis",
      sourceType: "WEB",
      reliability: "LOW",
      confidence: 0.3,
      collectedByAgentId: agent.id,
    });

    const linked = await opportunityService.attachEvidence({
      opportunityId: opportunity.id,
      evidenceId: evidence.id,
      actor: { actorType: "AGENT", actorId: agent.id },
    });

    expect(linked.map((e) => e.id)).toContain(evidence.id);
    const relisted = await opportunityService.listEvidence(opportunity.id);
    expect(relisted).toHaveLength(1);
  });

  it("verification states move through the transition table", async () => {
    const agent = await makeAgent();
    const evidence = await evidenceService.collectEvidence({
      claim: "x",
      source: "x",
      sourceType: "OTHER",
      reliability: "LOW",
      confidence: 0.5,
      collectedByAgentId: agent.id,
    });

    const verified = await evidenceService.setVerificationStatus({
      id: evidence.id,
      verificationStatus: "VERIFIED",
      actor: { actorType: "HUMAN", actorId: HUMAN_OWNER },
    });
    expect(verified.verificationStatus).toBe("VERIFIED");
  });

  it("rejects an unsupported verification status string", async () => {
    const agent = await makeAgent();
    const evidence = await evidenceService.collectEvidence({
      claim: "x",
      source: "x",
      sourceType: "OTHER",
      reliability: "LOW",
      confidence: 0.5,
      collectedByAgentId: agent.id,
    });

    await expect(
      evidenceService.setVerificationStatus({
        id: evidence.id,
        verificationStatus: "TOTALLY_TRUE",
        actor: { actorType: "HUMAN", actorId: HUMAN_OWNER },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects transitioning out of the terminal REJECTED verification state", async () => {
    const agent = await makeAgent();
    const evidence = await evidenceService.collectEvidence({
      claim: "x",
      source: "x",
      sourceType: "OTHER",
      reliability: "LOW",
      confidence: 0.5,
      collectedByAgentId: agent.id,
    });
    await evidenceService.setVerificationStatus({
      id: evidence.id,
      verificationStatus: "REJECTED",
      actor: { actorType: "HUMAN", actorId: HUMAN_OWNER },
    });

    await expect(
      evidenceService.setVerificationStatus({
        id: evidence.id,
        verificationStatus: "VERIFIED",
        actor: { actorType: "HUMAN", actorId: HUMAN_OWNER },
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

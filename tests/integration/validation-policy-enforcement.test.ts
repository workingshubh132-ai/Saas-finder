import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/shared/errors.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

function authActor() {
  return { type: "HUMAN" as const, id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId };
}

async function opportunityWithLevel4Evidence() {
  const agent = await makeAgent();
  const opportunity = await opportunityService.createOpportunity({
    title: "t",
    problem: "p",
    targetCustomer: "t",
    description: "d",
    discoveredBy: { actorType: "AGENT", actorId: agent.id },
  });
  const customerEvidence = await evidenceService.collectEvidence({
    claim: "A real customer confirmed this pain in an interview.",
    source: "interview",
    sourceType: "CUSTOMER",
    reliability: "MEDIUM",
    confidence: 0.6,
    collectedByAgentId: agent.id,
  });
  const marketEvidence = await evidenceService.collectEvidence({
    claim: "Competitors charge for a partial solution.",
    source: "competitor research",
    sourceType: "MARKET_DATA",
    reliability: "MEDIUM",
    confidence: 0.6,
    collectedByAgentId: agent.id,
  });
  await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: customerEvidence.id, actor: { actorType: "AGENT", actorId: agent.id } });
  await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: marketEvidence.id, actor: { actorType: "AGENT", actorId: agent.id } });
  return { agent, opportunity };
}

describe("opportunityService.setValidationLevel — full policy enforcement", () => {
  it("rejects an evidence mix that doesn't satisfy the target level, with specific reasons", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "t",
      problem: "p",
      targetCustomer: "t",
      description: "d",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });

    await expect(
      opportunityService.setValidationLevel({ id: opportunity.id, validationLevel: "LEVEL_5", actor: HUMAN_OWNER }),
    ).rejects.toThrow(ValidationError);
  });

  it("LEVEL_4 requires a HUMAN actor — an AGENT is rejected even with sufficient evidence", async () => {
    const { agent, opportunity } = await opportunityWithLevel4Evidence();

    await expect(
      opportunityService.setValidationLevel({
        id: opportunity.id,
        validationLevel: "LEVEL_4",
        actor: { actorType: "AGENT", actorId: agent.id },
      }),
    ).rejects.toThrow(/HUMAN actor/);
  });

  it("LEVEL_4 succeeds for a HUMAN actor once the evidence mix satisfies the policy", async () => {
    const { opportunity } = await opportunityWithLevel4Evidence();

    const updated = await opportunityService.setValidationLevel({ id: opportunity.id, validationLevel: "LEVEL_4", actor: HUMAN_OWNER });

    expect(updated.validationLevel).toBe("LEVEL_4");
  });

  it("LEVEL_5 requires a standing Chairman APPROVE review, not just sufficient evidence and a human actor", async () => {
    const { agent, opportunity } = await opportunityWithLevel4Evidence();
    // Add a third, HIGH-reliability CUSTOMER record to meet LEVEL_5's evidence bar.
    const strongCustomerEvidence = await evidenceService.collectEvidence({
      claim: "A second customer confirmed willingness to pay.",
      source: "interview",
      sourceType: "CUSTOMER",
      reliability: "HIGH",
      confidence: 0.85,
      collectedByAgentId: agent.id,
    });
    await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: strongCustomerEvidence.id, actor: { actorType: "AGENT", actorId: agent.id } });

    await expect(
      opportunityService.setValidationLevel({ id: opportunity.id, validationLevel: "LEVEL_5", actor: HUMAN_OWNER }),
    ).rejects.toThrow(/Chairman/);

    // Force a strong score so the deterministic dev-mode Chairman fixture approves.
    await opportunityService.scoreOpportunity({
      opportunityId: opportunity.id,
      scoredBy: agent.id,
      dimensions: { pain: 0.9, demand: 0.9, willingnessToPay: 0.9, reachability: 0.8, retention: 0.8, differentiation: 0.7, buildability: 0.8, economics: 0.8, risk: 0.1, evidenceQuality: 0.9 },
    });
    const review = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    expect(review.decision.decision).toBe("APPROVE");

    const updated = await opportunityService.setValidationLevel({ id: opportunity.id, validationLevel: "LEVEL_5", actor: HUMAN_OWNER });
    expect(updated.validationLevel).toBe("LEVEL_5");
  });
});

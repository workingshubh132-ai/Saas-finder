import { describe, expect, it } from "vitest";
import { InvalidTransitionError, ValidationError } from "../../src/domain/shared/errors.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import type { OpportunityScoreDimensions } from "../../src/services/opportunity-scorer.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

const dimensions: OpportunityScoreDimensions = {
  pain: 0.7,
  demand: 0.6,
  willingnessToPay: 0.6,
  reachability: 0.5,
  retention: 0.6,
  differentiation: 0.5,
  buildability: 0.7,
  economics: 0.6,
  risk: 0.3,
  evidenceQuality: 0.5,
};

describe("opportunityService", () => {
  it("walks the full lifecycle DISCOVERED -> ... -> APPROVED -> ARCHIVED", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "x",
      problem: "x",
      targetCustomer: "x",
      description: "x",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });
    expect(opportunity.status).toBe("DISCOVERED");

    const actor = HUMAN_OWNER;
    await opportunityService.transition({ id: opportunity.id, toStatus: "RESEARCHING", actor });
    await opportunityService.transition({ id: opportunity.id, toStatus: "VALIDATING", actor });
    await opportunityService.transition({ id: opportunity.id, toStatus: "VALIDATED", actor });
    const approved = await opportunityService.transition({ id: opportunity.id, toStatus: "APPROVED", actor });
    expect(approved.status).toBe("APPROVED");
    const archived = await opportunityService.transition({ id: opportunity.id, toStatus: "ARCHIVED", actor });
    expect(archived.status).toBe("ARCHIVED");
  });

  it("rejects skipping straight to APPROVED", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "x",
      problem: "x",
      targetCustomer: "x",
      description: "x",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });

    await expect(
      opportunityService.transition({
        id: opportunity.id,
        toStatus: "APPROVED",
        actor: HUMAN_OWNER,
      }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("scoring persists opportunity_score/confidence_score and a history record", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "x",
      problem: "x",
      targetCustomer: "x",
      description: "x",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });

    const scored = await opportunityService.scoreOpportunity({ opportunityId: opportunity.id, dimensions, scoredBy: agent.id });
    expect(scored.opportunityScore).not.toBeNull();
    expect(scored.confidenceScore).not.toBeNull();

    const history = await opportunityService.listScoreHistory(opportunity.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.scoredBy).toBe(agent.id);
  });

  it("cannot claim a validation level above LEVEL_0 without evidence, and can once evidence exists", async () => {
    const agent = await makeAgent();
    const opportunity = await opportunityService.createOpportunity({
      title: "x",
      problem: "x",
      targetCustomer: "x",
      description: "x",
      discoveredBy: { actorType: "AGENT", actorId: agent.id },
    });

    await expect(
      opportunityService.setValidationLevel({
        id: opportunity.id,
        validationLevel: "LEVEL_6",
        actor: { actorType: "AGENT", actorId: agent.id },
      }),
    ).rejects.toThrow(ValidationError);

    const evidence = await evidenceService.collectEvidence({
      claim: "x",
      source: "x",
      sourceType: "MARKET_DATA",
      reliability: "HIGH",
      confidence: 0.8,
      collectedByAgentId: agent.id,
    });
    await opportunityService.attachEvidence({
      opportunityId: opportunity.id,
      evidenceId: evidence.id,
      actor: { actorType: "AGENT", actorId: agent.id },
    });

    // LEVEL_1 only, not LEVEL_2+: the fuller per-level policy
    // (docs/VALIDATION_POLICY.md) requires more than one evidence
    // record for LEVEL_2 and above — see tests/integration/validation-policy.test.ts.
    const updated = await opportunityService.setValidationLevel({
      id: opportunity.id,
      validationLevel: "LEVEL_1",
      actor: { actorType: "AGENT", actorId: agent.id },
    });
    expect(updated.validationLevel).toBe("LEVEL_1");
  });
});

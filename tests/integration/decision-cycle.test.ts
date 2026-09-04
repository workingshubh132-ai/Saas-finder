import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { decisionCycleService } from "../../src/services/decision-cycle.service.js";
import { authActor, makeAgent, makeFullAgentSet, makeOpportunity } from "../helpers.js";

describe("decisionCycleService.run", () => {
  it("runs claim extraction, validation, confidence recalculation, and CEO reasoning as one bounded cycle", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const result = await decisionCycleService.run({
      opportunityId: opportunity.id,
      evidenceValidatorAgentId: agents.validatorAgent.id,
      ceoAgentId: agents.ceoAgent.id,
      startedBy: authActor(),
    });

    expect(result.cycle.status).toBe("COMPLETED");
    expect(result.claimsExtracted).toBe(13);
    expect(result.claimsValidated).toBe(13);
    expect(result.ceoRecommendation).not.toBeNull();
    expect(result.cycle.claimsValidated).toBe(13);
  });

  it("is safe to run twice on the same opportunity — no duplicate claims, a second historized CeoRecommendation", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    await decisionCycleService.run({ opportunityId: opportunity.id, evidenceValidatorAgentId: agents.validatorAgent.id, ceoAgentId: agents.ceoAgent.id, startedBy: authActor() });
    const second = await decisionCycleService.run({ opportunityId: opportunity.id, evidenceValidatorAgentId: agents.validatorAgent.id, ceoAgentId: agents.ceoAgent.id, startedBy: authActor() });

    expect(second.cycle.status).toBe("COMPLETED");
    expect(second.claimsExtracted).toBe(13);

    const claimCount = await prisma.claim.count({ where: { opportunityId: opportunity.id } });
    expect(claimCount).toBe(13);
    const recommendationCount = await prisma.ceoRecommendation.count({ where: { opportunityId: opportunity.id } });
    expect(recommendationCount).toBe(2);
  });

  it("transitions to AWAITING_HUMAN rather than failing when the Evidence Validator lacks READ_WEB and search is requested", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    // A validator agent with no READ_WEB grant.
    const ungrantedValidator = await makeAgent({ role: "Evidence Validator" });

    const result = await decisionCycleService.run({
      opportunityId: opportunity.id,
      evidenceValidatorAgentId: ungrantedValidator.id,
      ceoAgentId: agents.ceoAgent.id,
      startedBy: authActor(),
      budgetOverrides: { maxValidatorSearches: 2 },
    });

    expect(result.cycle.status).toBe("AWAITING_HUMAN");
    expect(result.claimsExtracted).toBe(0);
  });
});

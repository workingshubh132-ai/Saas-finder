import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimService } from "../../src/services/claim.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { investmentMemoService } from "../../src/services/investment-memo.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";

describe("investmentMemoService.compile", () => {
  it("derives strongestArgumentAgainst from the Chairman's own top objection and investmentThesis from the CEO's own reasoning — zero new model calls", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const problemClaim = claims.find((c) => c.claimType === "CUSTOMER_PROBLEM")!;
    await claimService.setStatus({ id: problemClaim.id, toStatus: "CONTRADICTED", confidence: 0.1, actorType: "SYSTEM", actorId: null });

    const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") return;

    const chairmanResult = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    const { memo, content } = await investmentMemoService.compile({
      opportunityId: opportunity.id,
      ceoRecommendationId: ceoOutcome.result.recommendation.id,
      chairmanReviewId: chairmanResult.review.id,
      actorType: "AGENT",
      actorId: agents.ceoAgent.id,
    });

    expect(memo.strongestArgumentAgainst).toBe(chairmanResult.decision.objections[0]);
    expect(memo.investmentThesis).toBe(ceoOutcome.result.recommendation.reasoning);
    expect(memo.recommendation).toContain(ceoOutcome.result.recommendation.action);
    expect(memo.recommendation).toContain(chairmanResult.decision.decision);
    expect(memo.keyReason.length).toBeGreaterThan(0);
    expect(memo.biggestRisk.length).toBeGreaterThan(0);
    expect(memo.nextAction.length).toBeGreaterThan(0);
    expect(content.humanDecision).toBe("PENDING");
    expect(content.ceoRecommendation.action).toBe(ceoOutcome.result.recommendation.action);
    expect(content.validatorFindings.length).toBe(13);
  });

  it("rejects a CEO recommendation / Chairman review pair that doesn't belong to the given opportunity", async () => {
    const agents = await makeFullAgentSet();
    const opportunityA = await makeOpportunity();
    const opportunityB = await makeOpportunity();
    await claimExtractionService.extractForOpportunity({ opportunityId: opportunityA.id, actorType: "SYSTEM", actorId: null });

    const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunityA.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") return;
    const chairmanResult = await chairmanService.review({ opportunityId: opportunityA.id, reviewedBy: authActor() });

    await expect(
      investmentMemoService.compile({
        opportunityId: opportunityB.id,
        ceoRecommendationId: ceoOutcome.result.recommendation.id,
        chairmanReviewId: chairmanResult.review.id,
        actorType: "AGENT",
        actorId: agents.ceoAgent.id,
      }),
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimService } from "../../src/services/claim.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";

describe("ceoReasoningService.run", () => {
  it("makes zero tool calls and cites at least one real claim id", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    const outcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const rec = outcome.result.recommendation;
    expect(["KILL", "DEPRIORITIZE", "INVESTIGATE", "VALIDATE_CUSTOMER", "PREPARE_REVIEW", "HUMAN_REVIEW"]).toContain(rec.action);
    const citedClaimIds = JSON.parse(rec.citedClaimIds) as string[];
    expect(citedClaimIds.length).toBeGreaterThan(0);
    expect(rec.reasoning.length).toBeGreaterThan(0);
  });

  it("recommends KILL, citing the contradicted claim, when a CRITICAL/HIGH claim is CONTRADICTED", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const problemClaim = claims.find((c) => c.claimType === "CUSTOMER_PROBLEM")!;
    await claimService.setStatus({ id: problemClaim.id, toStatus: "CONTRADICTED", confidence: 0.1, actorType: "SYSTEM", actorId: null });

    const outcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.recommendation.action).toBe("KILL");
    const citedClaimIds = JSON.parse(outcome.result.recommendation.citedClaimIds) as string[];
    expect(citedClaimIds).toContain(problemClaim.id);
  });

  it("throws a clear error rather than fabricating a recommendation for an opportunity with no claims", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const outcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    // The dev fixture explicitly refuses to fabricate a citation when there is nothing to cite (claim-extraction must run first) — a FAILED execution, not a fabricated CeoRecommendation.
    expect(outcome.status).toBe("FAILED");
  });
});

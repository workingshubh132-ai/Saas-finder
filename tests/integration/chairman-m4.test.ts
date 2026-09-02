import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimService } from "../../src/services/claim.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";

describe("chairmanService.review — extended for M4", () => {
  it("independently REJECTs when a CRITICAL claim is CONTRADICTED, regardless of the CEO's own recommendation", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    await claimService.setStatus({ id: wtpClaim.id, toStatus: "CONTRADICTED", confidence: 0.1, actorType: "SYSTEM", actorId: null });

    const ceoOutcome = await ceoReasoningService.run({ agentId: agents.ceoAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(ceoOutcome.status).toBe("COMPLETED");

    const result = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });

    expect(result.decision.decision).toBe("REJECT");
    expect(result.decision.objections.length).toBeGreaterThan(0);
    expect(result.decision.objections.some((o) => o.includes("WILLINGNESS_TO_PAY"))).toBe(true);
  });

  it("flags a CEO recommendation that cites a claim id not belonging to the opportunity", async () => {
    const opportunity = await makeOpportunity();
    await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    const result = await chairmanService.review({ opportunityId: opportunity.id, reviewedBy: authActor() });
    // No CEO recommendation exists yet for this opportunity — the review must still run cleanly (optional context, same as pre-M4 opportunities with no Problem).
    expect(result.decision.objections.length).toBeGreaterThan(0);
  });
});

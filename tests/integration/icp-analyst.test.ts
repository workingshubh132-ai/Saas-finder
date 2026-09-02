import { describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { claimRepository } from "../../src/db/repositories/claim.repository.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { icpClaimService } from "../../src/services/icp-claim.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";

describe("icpAnalystService.run", () => {
  it("makes zero tool calls and grounds role/problemExposure/likelyFrequency in real claims once claims exist", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const segmentClaim = claims.find((c) => c.claimType === "CUSTOMER_SEGMENT")!;
    const problemClaim = claims.find((c) => c.claimType === "CUSTOMER_PROBLEM")!;
    const frequencyClaim = claims.find((c) => c.claimType === "FREQUENCY")!;

    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const { icpProfile } = outcome.result;
    expect(icpProfile.role).toBe(segmentClaim.statement);
    expect(icpProfile.problemExposure).toBe(problemClaim.statement);
    expect(icpProfile.likelyFrequency).toBe(frequencyClaim.statement);

    const grounding = JSON.parse(icpProfile.fieldGrounding) as Array<{ field: string; groundedInClaimIds: string[]; status: string }>;
    const roleGrounding = grounding.find((g) => g.field === "role")!;
    expect(roleGrounding.status).toBe("EVIDENCED");
    expect(roleGrounding.groundedInClaimIds).toContain(segmentClaim.id);

    // The dev fixture's role/problemExposure/likelyFrequency are verbatim identical to the already-existing claims they cite, so wiring must reuse those claims rather than creating noisy duplicates.
    expect(outcome.result.wiredClaims.map((c) => c.id).sort()).toEqual([segmentClaim.id, problemClaim.id, frequencyClaim.id].sort());
  });

  it("produces a conservative, honestly-ASSUMED ICP — never an invented specific one — for an opportunity with no claims yet", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const { icpProfile } = outcome.result;
    // No CUSTOMER_SEGMENT claim exists yet, so role must fall back to the opportunity's own already-known targetCustomer, not an invented persona.
    expect(icpProfile.role).toBe(opportunity.targetCustomer);
    expect(icpProfile.companySizeMin).toBeNull();
    expect(icpProfile.companySizeMax).toBeNull();
    expect(JSON.parse(icpProfile.exclusions)).toEqual([]);

    const grounding = JSON.parse(icpProfile.fieldGrounding) as Array<{ field: string; groundedInClaimIds: string[]; status: string }>;
    expect(grounding).toHaveLength(8);
    for (const g of grounding) {
      expect(g.status).toBe("ASSUMED");
      expect(g.groundedInClaimIds).toEqual([]);
    }

    // No claim existed to cite, so wiring must create three brand-new, low-confidence, UNVERIFIED claims — never fabricate a duplicate of something that doesn't exist.
    expect(outcome.result.wiredClaims).toHaveLength(3);
    const byType = new Map(outcome.result.wiredClaims.map((c) => [c.claimType, c] as const));
    expect(byType.get("CUSTOMER_SEGMENT")?.statement).toBe(opportunity.targetCustomer);
    expect(byType.get("CUSTOMER_SEGMENT")?.status).toBe("UNVERIFIED");
    expect(byType.get("CUSTOMER_SEGMENT")?.confidence).toBeCloseTo(0.2);
    expect(byType.get("CUSTOMER_SEGMENT")?.extractedFrom).toBe(`ICP_PROFILE.${icpProfile.id}.role`);
    expect(byType.has("CUSTOMER_PROBLEM")).toBe(true);
    expect(byType.has("FREQUENCY")).toBe(true);

    const allClaims = await claimRepository.listForOpportunity(opportunity.id);
    expect(allClaims).toHaveLength(3);
  });

  it("is idempotent per ICP profile — wiring the same profile's claims twice never duplicates them", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const rewired = await icpClaimService.wireForIcpProfile(outcome.result.icpProfile, { actorType: "SYSTEM", actorId: null });

    expect(rewired.map((c) => c.id).sort()).toEqual(outcome.result.wiredClaims.map((c) => c.id).sort());
    const allClaims = await claimRepository.listForOpportunity(opportunity.id);
    expect(allClaims).toHaveLength(3);
  });

  it("is historized — a second run creates a new IcpProfile row rather than overwriting the first", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();

    const first = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    const second = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("COMPLETED");
    if (first.status !== "COMPLETED" || second.status !== "COMPLETED") return;

    expect(first.result.icpProfile.id).not.toBe(second.result.icpProfile.id);
  });
});

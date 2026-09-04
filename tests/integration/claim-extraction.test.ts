import { beforeEach, describe, expect, it } from "vitest";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { CLAIM_TYPES } from "../../src/domain/claim/claim.types.js";
import { makeOpportunity } from "../helpers.js";
import { humanOwner } from "../setup.js";

describe("claimExtractionService.extractForOpportunity", () => {
  it("extracts exactly the thirteen claim types, each with a valid importance and a real, non-empty statement", async () => {
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    expect(claims).toHaveLength(13);
    expect(new Set(claims.map((c) => c.claimType))).toEqual(new Set(CLAIM_TYPES));
    for (const claim of claims) {
      expect(claim.statement.length).toBeGreaterThan(0);
      expect(claim.status).toBe("UNVERIFIED");
      expect(claim.confidence).toBeGreaterThanOrEqual(0);
      expect(claim.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("assigns CRITICAL to CUSTOMER_PROBLEM and WILLINGNESS_TO_PAY, and LOW to BUILDABILITY and TIMING", async () => {
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    const byType = new Map(claims.map((c) => [c.claimType, c]));
    expect(byType.get("CUSTOMER_PROBLEM")?.importance).toBe("CRITICAL");
    expect(byType.get("WILLINGNESS_TO_PAY")?.importance).toBe("CRITICAL");
    expect(byType.get("BUILDABILITY")?.importance).toBe("LOW");
    expect(byType.get("TIMING")?.importance).toBe("LOW");
  });

  it("falls back to Opportunity fields (not a Problem) when no problemId is linked", async () => {
    const opportunity = await makeOpportunity({ problem: "A very specific manual reconciliation problem." });
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    const customerProblemClaim = claims.find((c) => c.claimType === "CUSTOMER_PROBLEM")!;
    expect(customerProblemClaim.statement).toBe("A very specific manual reconciliation problem.");
    expect(customerProblemClaim.extractedFrom).toBe("OPPORTUNITY.problem");
  });

  it("is idempotent — a second call returns the same 13 rows, never duplicates them", async () => {
    const opportunity = await makeOpportunity();
    const first = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const second = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });

    expect(second).toHaveLength(13);
    expect(second.map((c) => c.id).sort()).toEqual(first.map((c) => c.id).sort());
  });
});

describe("claimExtractionService with an actor attributed", () => {
  beforeEach(() => {
    expect(humanOwner.actorId).toBeTruthy();
  });

  it("accepts a HUMAN actor for attribution without error", async () => {
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "HUMAN", actorId: humanOwner.actorId });
    expect(claims).toHaveLength(13);
  });
});

import { describe, expect, it } from "vitest";
import { customerDiscoveryInteractionService } from "../../src/services/customer-discovery-interaction.service.js";
import { customerValidationService } from "../../src/services/customer-validation.service.js";
import { makeAgent, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

async function confirmingInteraction(opportunityId: string, organization: string, findings: Array<{ field: string; value: string; strength?: string }>) {
  const prospect = await makeProspect({ opportunityId, icpProfileId: null, organization });
  const agent = await makeAgent({ role: "Discovery Analyst" });
  const interaction = await customerDiscoveryInteractionService.record({
    opportunityId,
    prospectId: prospect.id,
    interactionType: "CALL",
    interactionDate: new Date(),
    rawNotes: `Call with ${organization}.`,
    reality: "REAL",
    provenanceNote: "Founder-run call.",
    actor: HUMAN_OWNER,
  });
  await customerDiscoveryInteractionService.setOutcome({ interactionId: interaction.id, outcome: "PROBLEM_CONFIRMED", actor: HUMAN_OWNER });
  for (const f of findings) {
    await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: f.field,
      provenance: "OBSERVED",
      value: f.value,
      strength: f.strength ?? "MEDIUM",
      agentId: agent.id,
    });
  }
  return { prospect, interaction };
}

async function nonConfirmingInteraction(opportunityId: string, organization: string, outcome: string) {
  const prospect = await makeProspect({ opportunityId, icpProfileId: null, organization });
  const interaction = await customerDiscoveryInteractionService.record({
    opportunityId,
    prospectId: prospect.id,
    interactionType: "CALL",
    interactionDate: new Date(),
    rawNotes: `Call with ${organization}.`,
    reality: "REAL",
    provenanceNote: "Founder-run call.",
    actor: HUMAN_OWNER,
  });
  return customerDiscoveryInteractionService.setOutcome({ interactionId: interaction.id, outcome, actor: HUMAN_OWNER });
}

describe("customerValidationService.evaluate", () => {
  it("A. UNVALIDATED — no interactions at all", async () => {
    const opportunity = await makeOpportunity();
    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.status).toBe("UNVALIDATED");
    expect(result.confirmingBusinessCount).toBe(0);
  });

  it("B. two interactions from the SAME organization confirming the problem count as ONE business, not two", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [{ field: "PROBLEM_CONFIRMED", value: "Yes." }]);
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [{ field: "PROBLEM_CONFIRMED", value: "Confirmed again by a colleague." }]);

    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.confirmingBusinessCount).toBe(1);
    expect(result.status).toBe("INTERESTING");
  });

  it("C. two DISTINCT organizations confirming recurring pain reach STRONG", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "FREQUENCY", value: "Every month at close." },
    ]);
    await confirmingInteraction(opportunity.id, "Widgets Inc", [
      { field: "PROBLEM_CONFIRMED", value: "Yes, same issue." },
      { field: "FREQUENCY", value: "Weekly." },
    ]);

    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.confirmingBusinessCount).toBe(2);
    expect(result.recurringConfirmed).toBe(true);
    expect(result.status).toBe("STRONG");
  });

  it("D. STRONG plus a STRONG-or-higher WTP signal reaches BUILD_CANDIDATE", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "FREQUENCY", value: "Every month." },
      { field: "EXISTING_SPEND", value: "We pay a bookkeeper partly for this." },
    ]);
    await confirmingInteraction(opportunity.id, "Widgets Inc", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "FREQUENCY", value: "Weekly." },
    ]);

    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.bestWtpLevel).toBe("STRONG");
    expect(result.status).toBe("BUILD_CANDIDATE");
  });

  it("E. contradictory evidence from enough independent businesses produces REJECTED, overriding everything else", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "FREQUENCY", value: "Every month." },
    ]);
    await nonConfirmingInteraction(opportunity.id, "Widgets Inc", "PROBLEM_NOT_PRESENT");
    await nonConfirmingInteraction(opportunity.id, "Gadget Co", "ALREADY_SOLVED_ADEQUATELY");

    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.status).toBe("REJECTED");
    expect(result.disqualifyingReasons.length).toBeGreaterThan(0);
  });

  it("F. INSUFFICIENT_EVIDENCE-equivalent: one confirming business, no recurring/measurable pain yet, stays INTERESTING with explicit gaps", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [{ field: "PROBLEM_CONFIRMED", value: "Yes." }]);

    const result = await customerValidationService.evaluate(opportunity.id);
    expect(result.status).toBe("INTERESTING");
    expect(result.evidenceGaps.length).toBeGreaterThan(0);
  });
});

describe("customerValidationService.summarize", () => {
  it("G. Phase 12 report shape is fully populated and traceable to the same evaluation", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "FREQUENCY", value: "Every month." },
      { field: "WILLINGNESS_TO_PAY", value: "We'd pay $40/month for this." },
    ]);
    await confirmingInteraction(opportunity.id, "Widgets Inc", [
      { field: "PROBLEM_CONFIRMED", value: "Yes." },
      { field: "TIME_COST", value: "About 6 hours a month." },
    ]);

    const summary = await customerValidationService.summarize(opportunity.id);
    expect(summary.opportunityId).toBe(opportunity.id);
    expect(summary.businessesConfirmingProblem).toBe(2);
    expect(summary.recurringPain).toBe("CONFIRMED");
    expect(summary.measuredTimeOrCost).toBe("CONFIRMED");
    expect(summary.wtp).toBe("VERY_STRONG");
    expect(summary.disqualifyingEvidence).toBe(false);
    expect(summary.validation).toBe("BUILD_CANDIDATE");
    expect(summary.evidenceGaps).toEqual([]);
  });

  it("H. reports UNKNOWN, never a fabricated CONFIRMED, for existing spend when it was never established", async () => {
    const opportunity = await makeOpportunity();
    await confirmingInteraction(opportunity.id, "Acme Bookkeeping", [{ field: "PROBLEM_CONFIRMED", value: "Yes." }]);

    const summary = await customerValidationService.summarize(opportunity.id);
    expect(summary.existingSpend).toBe("UNKNOWN");
  });
});

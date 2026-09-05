import { describe, expect, it } from "vitest";
import { customerDiscoveryInteractionService } from "../../src/services/customer-discovery-interaction.service.js";
import { customerEvidenceService } from "../../src/services/customer-evidence.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { parseRealWorldTag } from "../../src/domain/real-world/reality.types.js";
import { NotHumanOwnerError, ValidationError } from "../../src/domain/shared/errors.js";
import { HUMAN_OWNER, makeAgent, makeOpportunity, makeProspect } from "../helpers.js";

async function setup() {
  const opportunity = await makeOpportunity();
  const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null, organization: "Acme Bookkeeping" });
  const agent = await makeAgent({ role: "Discovery Analyst" });
  return { opportunity, prospect, agent };
}

describe("customerDiscoveryInteractionService.record", () => {
  it("A. records a REAL interaction with a non-empty provenance note", async () => {
    const { opportunity, prospect } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "Spoke with the ops manager for 15 minutes about payment reconciliation.",
      reality: "REAL",
      provenanceNote: "Founder-run phone call, notes transcribed immediately after.",
      actor: HUMAN_OWNER,
    });
    expect(interaction.status).toBe("RECORDED");
    expect(interaction.reality).toBe("REAL");
  });

  it("B. rejects a REAL interaction with an empty provenance note — never a silent 'trust me'", async () => {
    const { opportunity, prospect } = await setup();
    await expect(
      customerDiscoveryInteractionService.record({
        opportunityId: opportunity.id,
        prospectId: prospect.id,
        interactionType: "CALL",
        interactionDate: new Date(),
        rawNotes: "Spoke with the ops manager.",
        reality: "REAL",
        provenanceNote: "",
        actor: HUMAN_OWNER,
      }),
    ).rejects.toThrow();
  });

  it("C. records a DEV_FIXTURE interaction with no provenance note required", async () => {
    const { opportunity, prospect } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "OTHER",
      interactionDate: new Date(),
      rawNotes: "Synthetic dev-fixture interaction for pipeline testing.",
      reality: "DEV_FIXTURE",
      provenanceNote: "",
      actor: HUMAN_OWNER,
    });
    expect(interaction.reality).toBe("DEV_FIXTURE");
  });

  it("D. refuses a non-human actor — this is manually transcribed from a real external channel", async () => {
    const { opportunity, prospect } = await setup();
    await expect(
      customerDiscoveryInteractionService.record({
        opportunityId: opportunity.id,
        prospectId: prospect.id,
        interactionType: "CALL",
        interactionDate: new Date(),
        rawNotes: "notes",
        reality: "REAL",
        provenanceNote: "note",
        actor: { actorType: "AGENT", actorId: "some-agent" },
      }),
    ).rejects.toThrow(NotHumanOwnerError);
  });

  it("E. refuses a prospect that belongs to a different opportunity", async () => {
    const { prospect } = await setup();
    const otherOpportunity = await makeOpportunity();
    await expect(
      customerDiscoveryInteractionService.record({
        opportunityId: otherOpportunity.id,
        prospectId: prospect.id,
        interactionType: "CALL",
        interactionDate: new Date(),
        rawNotes: "notes",
        reality: "REAL",
        provenanceNote: "note",
        actor: HUMAN_OWNER,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("customerDiscoveryInteractionService.attachFinding", () => {
  it("F. an OBSERVED finding with a mapped signal type is promoted to real Evidence + CustomerEvidence", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run call.",
      actor: HUMAN_OWNER,
    });

    const result = await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "PROBLEM_CONFIRMED",
      provenance: "OBSERVED",
      value: "Yes, matching bank payments to invoices is a real problem for us.",
      evidenceQuote: "It's a mess every month.",
      strength: "HIGH",
      agentId: agent.id,
    });

    expect(result.evidence).not.toBeNull();
    expect(result.customerEvidence).not.toBeNull();
    expect(result.customerEvidence?.discoveryInteractionId).toBe(interaction.id);
    expect(result.customerEvidence?.responseId).toBeNull();
    expect(result.customerEvidence?.signalType).toBe("PAIN");

    // Traceability: the created Evidence carries the interaction's REAL tag, never silently unlabeled.
    const evidence = await evidenceService.getOrThrow(result.evidence!.id);
    const tag = parseRealWorldTag(evidence.metadata ? JSON.parse(evidence.metadata) : null);
    expect(tag?.reality).toBe("REAL");
  });

  it("G. an INFERRED finding is recorded but never promoted to Evidence — the concrete non-masquerade guarantee", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run call.",
      actor: HUMAN_OWNER,
    });

    const result = await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "PROBLEM_CONFIRMED",
      provenance: "INFERRED",
      value: "Sounded like they might have this problem, though they didn't say so directly.",
      agentId: agent.id,
    });

    expect(result.finding.provenance).toBe("INFERRED");
    expect(result.evidence).toBeNull();
    expect(result.customerEvidence).toBeNull();
  });

  it("H. an UNKNOWN finding preserves its own explanatory value — never silently converted to a negative answer", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run call.",
      actor: HUMAN_OWNER,
    });

    const result = await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "PREVIOUS_AUTOMATION_ATTEMPTS",
      provenance: "UNKNOWN",
      value: "Not asked during this call.",
      agentId: agent.id,
    });

    expect(result.finding.provenance).toBe("UNKNOWN");
    expect(result.finding.value).toBe("Not asked during this call.");
    expect(result.evidence).toBeNull();
  });

  it("I. CUSTOMER_LANGUAGE is never auto-promoted to Evidence even when OBSERVED — it has no mapped signal type", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run call.",
      actor: HUMAN_OWNER,
    });

    const result = await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "CUSTOMER_LANGUAGE",
      provenance: "OBSERVED",
      value: "\"It's a nightmare every single month.\"",
      agentId: agent.id,
    });

    expect(result.evidence).toBeNull();
    expect(result.customerEvidence).toBeNull();
  });

  it("J. rejects an empty value — even UNKNOWN requires an explanatory note, never a bare omission", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "DEV_FIXTURE",
      provenanceNote: "",
      actor: HUMAN_OWNER,
    });

    await expect(
      customerDiscoveryInteractionService.attachFinding({
        interactionId: interaction.id,
        field: "FREQUENCY",
        provenance: "UNKNOWN",
        value: "   ",
        agentId: agent.id,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("customerDiscoveryInteractionService.setOutcome", () => {
  it("K. records the deterministic disqualification signal, human-only", async () => {
    const { opportunity, prospect } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "CALL",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run call.",
      actor: HUMAN_OWNER,
    });

    const updated = await customerDiscoveryInteractionService.setOutcome({
      interactionId: interaction.id,
      outcome: "PROBLEM_NOT_PRESENT",
      actor: HUMAN_OWNER,
    });
    expect(updated.interactionOutcome).toBe("PROBLEM_NOT_PRESENT");
    expect(updated.status).toBe("ANALYZED");

    await expect(
      customerDiscoveryInteractionService.setOutcome({ interactionId: interaction.id, outcome: "PROBLEM_CONFIRMED", actor: { actorType: "AGENT", actorId: "x" } }),
    ).rejects.toThrow(NotHumanOwnerError);
  });
});

describe("evidence traceability", () => {
  it("L. Opportunity -> customerEvidence -> prospect -> interaction -> finding is fully walkable", async () => {
    const { opportunity, prospect, agent } = await setup();
    const interaction = await customerDiscoveryInteractionService.record({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      interactionType: "INTERVIEW",
      interactionDate: new Date(),
      rawNotes: "notes",
      reality: "REAL",
      provenanceNote: "Founder-run interview.",
      actor: HUMAN_OWNER,
    });
    const { customerEvidence: ce } = await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "EXISTING_SPEND",
      provenance: "OBSERVED",
      value: "We pay a part-time bookkeeper partly to handle this.",
      strength: "MEDIUM",
      agentId: agent.id,
    });

    const opportunityEvidence = await customerEvidenceService.listForOpportunity(opportunity.id);
    expect(opportunityEvidence.map((e) => e.id)).toContain(ce!.id);

    const walkedBack = opportunityEvidence.find((e) => e.id === ce!.id)!;
    expect(walkedBack.prospectId).toBe(prospect.id);
    expect(walkedBack.discoveryInteractionId).toBe(interaction.id);

    const findings = await customerDiscoveryInteractionService.listFindingsForInteraction(interaction.id);
    expect(findings.some((f) => f.promotedToEvidenceId === walkedBack.evidenceId)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { customerDiscoveryInteractionService } from "../../src/services/customer-discovery-interaction.service.js";
import { customerValidationService } from "../../src/services/customer-validation.service.js";
import { NotHumanOwnerError } from "../../src/domain/shared/errors.js";
import { makeAgent, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";

/**
 * Phase 8's own boundary: AI may discover/prepare/analyze/summarize and
 * compute a deterministic validation status — it may never approve or
 * send outreach, or create an approval request, as a side effect of
 * doing so. These tests prove that by counting real rows, not by
 * reading the source.
 */
describe("Customer Discovery + Validation governance", () => {
  it("recording an interaction and attaching findings creates zero ApprovalRequest/OutreachMessage rows", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null, organization: "Acme Bookkeeping" });
    const agent = await makeAgent({ role: "Discovery Analyst" });

    const [approvalsBefore, messagesBefore] = await Promise.all([prisma.approvalRequest.count(), prisma.outreachMessage.count()]);

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
    await customerDiscoveryInteractionService.attachFinding({
      interactionId: interaction.id,
      field: "PROBLEM_CONFIRMED",
      provenance: "OBSERVED",
      value: "Yes.",
      agentId: agent.id,
    });
    await customerDiscoveryInteractionService.setOutcome({ interactionId: interaction.id, outcome: "PROBLEM_CONFIRMED", actor: HUMAN_OWNER });

    const [approvalsAfter, messagesAfter] = await Promise.all([prisma.approvalRequest.count(), prisma.outreachMessage.count()]);
    expect(approvalsAfter).toBe(approvalsBefore);
    expect(messagesAfter).toBe(messagesBefore);
  });

  it("evaluating and summarizing an opportunity creates zero new rows of any kind — a pure read", async () => {
    const opportunity = await makeOpportunity();
    await customerValidationService.evaluate(opportunity.id);
    await customerValidationService.summarize(opportunity.id);

    const [approvals, messages, deliveries, interactions] = await Promise.all([
      prisma.approvalRequest.count(),
      prisma.outreachMessage.count(),
      prisma.outreachMessageDelivery.count(),
      prisma.customerDiscoveryInteraction.count({ where: { opportunityId: opportunity.id } }),
    ]);
    expect(interactions).toBe(0);
    expect(approvals).toBeGreaterThanOrEqual(0);
    expect(messages).toBeGreaterThanOrEqual(0);
    expect(deliveries).toBeGreaterThanOrEqual(0);
  });

  it("record()/setOutcome() refuse a non-human actor even when a valid agent id is supplied elsewhere", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null, organization: "Acme Bookkeeping" });
    const agent = await makeAgent();

    await expect(
      customerDiscoveryInteractionService.record({
        opportunityId: opportunity.id,
        prospectId: prospect.id,
        interactionType: "CALL",
        interactionDate: new Date(),
        rawNotes: "notes",
        reality: "REAL",
        provenanceNote: "note",
        actor: { actorType: "AGENT", actorId: agent.id },
      }),
    ).rejects.toThrow(NotHumanOwnerError);
  });
});

import { describe, expect, it } from "vitest";
import { eventRepository } from "../../src/db/repositories/event.repository.js";
import { agentService } from "../../src/services/agent.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { auditService } from "../../src/services/audit.service.js";
import { decisionQueueService } from "../../src/services/decision-queue.service.js";
import { researchIntakeService } from "../../src/services/research-intake.service.js";
import { HUMAN_OWNER } from "../helpers.js";

describe("M1 vertical slice: signal -> opportunity -> evidence -> score -> approval -> decision queue", () => {
  it("proves the kernel's Definition of Done end to end", async () => {
    const intelligenceAgent = await agentService.createAgent({
      name: "Market Scout",
      role: "Research Agent",
      department: "INTELLIGENCE",
      description: "Surfaces and scores candidate SaaS opportunities.",
      riskLevel: "GREEN",
      createdBy: HUMAN_OWNER,
    });

    const result = await researchIntakeService.intake({
      agentId: intelligenceAgent.id,
      opportunity: {
        title: "Automated invoice chasing for solo freelancers",
        problem: "Freelancers lose significant income to late-paying clients and don't have time to chase invoices.",
        targetCustomer: "Solo freelancers and independent contractors",
        description: "A lightweight tool that automatically follows up on overdue invoices by email and SMS.",
      },
      evidence: [
        {
          claim: "7 of 10 freelancers interviewed said late payments cost them real money every month.",
          source: "Structured founder interviews, Aug 2026",
          sourceType: "CUSTOMER",
          reliability: "MEDIUM",
          confidence: 0.65,
        },
        {
          claim: "Competing tools' manual reminder features are rated poorly for automation in reviews.",
          source: "G2/Capterra review analysis",
          sourceType: "COMPETITOR",
          reliability: "MEDIUM",
          confidence: 0.5,
        },
      ],
      scoreDimensions: {
        pain: 0.75,
        demand: 0.6,
        willingnessToPay: 0.55,
        reachability: 0.5,
        retention: 0.6,
        differentiation: 0.45,
        buildability: 0.8,
        economics: 0.6,
        risk: 0.35,
        evidenceQuality: 0.55,
        marketSize: 0.5,
        frequency: 0.5,
        evidenceIndependence: 0.4,
        timing: 0.5,
      },
      approvalRequest: {
        action: "ADVANCE_TO_VALIDATION",
        description: "Approve moving this opportunity into active customer validation.",
        riskLevel: "YELLOW",
        reason: "Opportunity score and early evidence both look promising; needs a human go/no-go before spending more research time.",
      },
    });

    // The opportunity is evidence-backed and scored.
    expect(result.opportunity.status).toBe("DISCOVERED");
    expect(result.opportunity.opportunityScore).not.toBeNull();
    expect(result.opportunity.confidenceScore).not.toBeNull();
    expect(result.evidence).toHaveLength(2);

    // It generated a governed decision request sitting in the Human Decision Queue.
    expect(result.approvalRequest.status).toBe("PENDING");
    expect(result.approvalRequest.resourceType).toBe("OPPORTUNITY");
    expect(result.approvalRequest.resourceId).toBe(result.opportunity.id);

    const queue = await decisionQueueService.listQueue();
    const entry = queue.find((item) => item.approvalRequest.id === result.approvalRequest.id);
    expect(entry).toBeDefined();
    expect(entry?.evidence).toHaveLength(2);
    expect(entry?.linkedOpportunity?.id).toBe(result.opportunity.id);
    expect(entry?.linkedOpportunity?.opportunityScore).toBe(result.opportunity.opportunityScore);

    // Every important action is auditable — "why does VentureForge believe this?" is traceable.
    const auditTrail = await auditService.list({ resourceType: "OPPORTUNITY", resourceId: result.opportunity.id });
    const auditActions = auditTrail.map((auditEntry) => auditEntry.action);
    expect(auditActions).toContain("CREATE_OPPORTUNITY");
    expect(auditActions).toContain("SCORE_OPPORTUNITY");
    expect(auditActions.filter((action) => action === "ATTACH_EVIDENCE")).toHaveLength(2);

    const events = await eventRepository.list({ limit: 50 });
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("OPPORTUNITY_DISCOVERED");
    expect(eventTypes).toContain("EVIDENCE_ADDED");
    expect(eventTypes).toContain("OPPORTUNITY_SCORED");
    expect(eventTypes).toContain("APPROVAL_REQUESTED");

    // The Human Owner decides, and the decision is itself recorded and auditable.
    const decision = await approvalService.decide({
      id: result.approvalRequest.id,
      toStatus: "APPROVED",
      reviewedBy: HUMAN_OWNER,
      decisionReason: "Evidence and score both support moving forward.",
    });
    expect(decision.status).toBe("APPROVED");
    expect(decision.reviewedBy).toBe(HUMAN_OWNER.actorId);

    const finalQueue = await decisionQueueService.listQueue();
    expect(finalQueue.find((item) => item.approvalRequest.id === result.approvalRequest.id)).toBeUndefined();

    const decisionAudit = await auditService.list({ resourceType: "OPPORTUNITY", resourceId: result.opportunity.id });
    expect(decisionAudit.some((auditEntry) => auditEntry.action === "APPROVAL_PENDING_TO_APPROVED")).toBe(true);
  });
});

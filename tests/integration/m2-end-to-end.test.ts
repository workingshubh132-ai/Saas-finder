import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { prisma } from "../../src/db/client.js";

const app = createApp();

/**
 * M2 brief Part 27 — the capstone test. Drives the entire chain over
 * the real HTTP API, exactly as a real client would:
 *
 *   Authenticated Human -> Create Research Task -> Assign Research Agent
 *   -> Agent Execution -> Research Tool -> Structured Findings -> Evidence
 *   -> Opportunity -> Opportunity Score -> Chairman Review
 *   -> Human Decision Queue -> Human Decision
 *
 * Every step reads back its own real state from the API — no
 * intermediate step is assumed to have succeeded without checking.
 */
describe("M2 end-to-end: research signal to governed, audited human decision", () => {
  it("runs the full chain and leaves a complete, auditable trail", async () => {
    // 1. Bootstrap the Human Owner identity (a genuinely fresh deployment: no
    // prior identity exists — tests/setup.ts's own bootstrap identity is
    // cleared here specifically to demonstrate the real from-scratch path).
    await prisma.identity.deleteMany();
    const bootstrapRes = await request(app).post("/api/identities").send({ type: "HUMAN", label: "Founder" });
    expect(bootstrapRes.status).toBe(201);
    const humanToken = bootstrapRes.body.token as string;
    const human = `Bearer ${humanToken}`;

    // 2. The Human registers the Research Agent (identity + permission — Guardian's baseline).
    const agentRes = await request(app)
      .post("/api/agents")
      .set("Authorization", human)
      .send({
        name: "Market Scout",
        role: "Research Agent",
        department: "INTELLIGENCE",
        description: "Finds and analyzes evidence for potential SaaS opportunities.",
        riskLevel: "GREEN",
      });
    expect(agentRes.status).toBe(201);
    const agentId = agentRes.body.id as string;
    expect(agentRes.body.status).toBe("ACTIVE");

    const grantRes = await request(app)
      .post(`/api/agents/${agentId}/permissions`)
      .set("Authorization", human)
      .send({ permission: "READ_WEB" });
    expect(grantRes.status).toBe(201);

    // Guardian check, direct: the agent is authorized for READ_WEB and nothing else.
    const authorizeOk = await request(app).post("/api/authorize").set("Authorization", human).send({ agentId, action: "READ_WEB" });
    expect(authorizeOk.body.decision).toBe("ALLOWED");
    const authorizeDenied = await request(app)
      .post("/api/authorize")
      .set("Authorization", human)
      .send({ agentId, action: "SPEND_MONEY" });
    expect(authorizeDenied.body.decision).toBe("DENIED"); // never granted -> fails closed, regardless of risk level

    // 3. Create the CEO/Research Task and assign it to the agent.
    const taskRes = await request(app)
      .post("/api/tasks")
      .set("Authorization", human)
      .send({
        title: "Find a promising SaaS opportunity",
        objective: "Find a promising SaaS opportunity for small businesses.",
        assignedAgentId: agentId,
        riskLevel: "GREEN",
      });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;

    // 4. Run the Research Agent: Plan -> Tool -> Synthesize -> Process.
    const researchRes = await request(app)
      .post("/api/research")
      .set("Authorization", human)
      .send({ agentId, objective: "Find a promising SaaS opportunity for small businesses.", taskId });
    expect(researchRes.status).toBe(201);
    expect(researchRes.body.status).toBe("COMPLETED");
    const executionId = researchRes.body.execution.id as string;
    const opportunityId = researchRes.body.result.opportunityId as string;

    // 5. Read back the execution's own telemetry — the real tool call happened, was authorized, and is on record.
    const executionRes = await request(app).get(`/api/agent-executions/${executionId}`).set("Authorization", human);
    expect(executionRes.status).toBe(200);
    expect(executionRes.body.execution.status).toBe("COMPLETED");
    expect(executionRes.body.execution.agentId).toBe(agentId);
    expect(executionRes.body.execution.taskId).toBe(taskId);
    expect(executionRes.body.execution.toolCallCount).toBeGreaterThan(0);
    expect(executionRes.body.toolExecutions.length).toBeGreaterThan(0);
    expect(executionRes.body.toolExecutions[0].status).toBe("SUCCESS");

    // 6. The Opportunity exists, is evidence-backed, and is scored — but not self-validated.
    const opportunityRes = await request(app).get(`/api/opportunities/${opportunityId}`).set("Authorization", human);
    expect(opportunityRes.status).toBe(200);
    expect(opportunityRes.body.status).toBe("DISCOVERED");
    expect(opportunityRes.body.validationLevel).toBe("LEVEL_0");
    expect(opportunityRes.body.opportunityScore).not.toBeNull();
    expect(opportunityRes.body.confidenceScore).not.toBeNull();

    // 7. Evidence preserves provenance: real claim, real source reference, the collecting agent.
    const evidenceRes = await request(app).get(`/api/opportunities/${opportunityId}/evidence`).set("Authorization", human);
    expect(evidenceRes.status).toBe(200);
    expect(evidenceRes.body.length).toBeGreaterThan(0);
    for (const item of evidenceRes.body) {
      expect(item.collectedByAgentId).toBe(agentId);
      expect(item.sourceReference).toBeTruthy();
      expect(item.claim).toBeTruthy();
    }

    // 8. Chairman review: genuinely adversarial, not a rubber stamp — objections are always present.
    const chairmanRes = await request(app).post(`/api/opportunities/${opportunityId}/chairman-review`).set("Authorization", human);
    expect(chairmanRes.status).toBe(201);
    expect(chairmanRes.body.decision.objections.length).toBeGreaterThan(0);
    expect(["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE", "DEFER", "ESCALATE_TO_HUMAN"]).toContain(chairmanRes.body.decision.decision);

    // 9. The formal ask enters the Human Decision Queue (PROPOSAL -> CEO -> CHAIRMAN -> GUARDIAN -> HUMAN).
    const approvalRes = await request(app)
      .post(`/api/opportunities/${opportunityId}/request-approval`)
      .set("Authorization", human)
      .send({
        requestedByAgentId: agentId,
        action: "ADVANCE_TO_VALIDATION",
        description: "Advance this opportunity into active customer validation.",
        riskLevel: "YELLOW",
        reason: `Chairman recommendation: ${chairmanRes.body.decision.recommendation}`,
      });
    expect(approvalRes.status).toBe(201);
    expect(approvalRes.body.status).toBe("PENDING");
    const approvalRequestId = approvalRes.body.id as string;

    const queueRes = await request(app).get("/api/decisions").set("Authorization", human);
    expect(queueRes.status).toBe(200);
    const entry = (queueRes.body as Array<{ approvalRequest: { id: string }; chairmanReview: { decision: string } | null }>).find(
      (item) => item.approvalRequest.id === approvalRequestId,
    );
    expect(entry).toBeDefined();
    expect(entry?.chairmanReview?.decision).toBe(chairmanRes.body.decision.decision);

    // 10. The Human decides. Self-approval is structurally impossible — the
    // agent's own credential could never reach this HUMAN-only route.
    const decisionRes = await request(app).post(`/api/decisions/${approvalRequestId}/approve`).set("Authorization", human).send({});
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.status).toBe("APPROVED");
    expect(decisionRes.body.reviewedAt).not.toBeNull();

    // 11. Audit: the full chain is reconstructable from the audit log alone.
    const auditRes = await request(app).get(`/api/audit-logs?resourceType=OPPORTUNITY&resourceId=${opportunityId}`).set("Authorization", human);
    expect(auditRes.status).toBe(200);
    const actions = (auditRes.body as Array<{ action: string }>).map((entry2) => entry2.action);
    expect(actions).toContain("CREATE_OPPORTUNITY");
    expect(actions).toContain("SCORE_OPPORTUNITY");
    expect(actions.some((action) => action.startsWith("CHAIRMAN_REVIEW_"))).toBe(true);
    expect(actions.some((action) => action.startsWith("APPROVAL_PENDING_TO_"))).toBe(true);

    // Events: every major stage published a domain event.
    const eventsRes = await request(app).get("/api/events?limit=100").set("Authorization", human);
    const eventTypes = (eventsRes.body as Array<{ type: string }>).map((event) => event.type);
    expect(eventTypes).toContain("AGENT_CREATED");
    expect(eventTypes).toContain("TASK_CREATED");
    expect(eventTypes).toContain("OPPORTUNITY_DISCOVERED");
    expect(eventTypes).toContain("EVIDENCE_ADDED");
    expect(eventTypes).toContain("OPPORTUNITY_SCORED");
    expect(eventTypes).toContain("APPROVAL_REQUESTED");
    expect(eventTypes).toContain("APPROVAL_APPROVED");
  });
});

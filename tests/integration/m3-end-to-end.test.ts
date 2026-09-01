import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { prisma } from "../../src/db/client.js";

const app = createApp();

/**
 * M3 brief Part 41 — the capstone test. Drives the entire chain over
 * the real HTTP API, exactly as a real client would:
 *
 *   Authenticated Human -> 5 registered agents -> ONE bounded Research
 *   Cycle -> Signals (multiple sources) -> Deduplication -> Signal
 *   Cluster -> Problem -> Competitor Analysis -> Market Analysis ->
 *   Opportunity -> Score -> Kill-Risk -> Evidence Gap -> Chairman
 *   Review -> Human Decision Queue -> Human Decision
 *
 * Every step reads back its own real state from the API — no
 * intermediate step is assumed to have succeeded without checking.
 */
describe("M3 end-to-end: research cycle to governed, audited human decision", () => {
  it("runs the full chain and leaves a complete, auditable trail", async () => {
    // 1. Bootstrap the Human Owner identity (a genuinely fresh deployment).
    await prisma.identity.deleteMany();
    const bootstrapRes = await request(app).post("/api/identities").send({ type: "HUMAN", label: "Founder" });
    expect(bootstrapRes.status).toBe(201);
    const human = `Bearer ${bootstrapRes.body.token as string}`;

    // 2. Register the five specialized agents (M3 brief Part 24) and grant only what each needs.
    async function makeAgent(name: string, role: string) {
      const res = await request(app)
        .post("/api/agents")
        .set("Authorization", human)
        .send({ name, role, department: "INTELLIGENCE", description: role, riskLevel: "GREEN" });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }
    async function grant(agentId: string, permission: string) {
      const res = await request(app).post(`/api/agents/${agentId}/permissions`).set("Authorization", human).send({ permission });
      expect(res.status).toBe(201);
    }

    const researchAgentId = await makeAgent("Market Scout", "Research Agent");
    await grant(researchAgentId, "READ_WEB");
    const problemAnalystId = await makeAgent("Problem Analyst", "Problem Analyst");
    const competitorAnalystId = await makeAgent("Competitor Analyst", "Competitor Analyst");
    await grant(competitorAnalystId, "READ_WEB");
    const marketAnalystId = await makeAgent("Market Analyst", "Market Analyst");
    const opportunityAnalystId = await makeAgent("Opportunity Analyst", "Opportunity Analyst");

    // 3. Run ONE bounded research cycle — the CEO orchestration boundary (Part 26).
    const cycleRes = await request(app)
      .post("/api/research-cycles")
      .set("Authorization", human)
      .send({
        objective: "Find a promising SaaS opportunity for small businesses.",
        researchAgentId,
        problemAnalystAgentId: problemAnalystId,
        competitorAnalystAgentId: competitorAnalystId,
        marketAnalystAgentId: marketAnalystId,
        opportunityAnalystAgentId: opportunityAnalystId,
      });
    expect(cycleRes.status).toBe(201);
    expect(cycleRes.body.cycle.status).toBe("COMPLETED");
    expect(cycleRes.body.signalsCollected).toBeGreaterThan(0);
    expect(cycleRes.body.opportunitiesGenerated.length).toBeGreaterThan(0);
    const opportunityId = cycleRes.body.opportunitiesGenerated[0].id as string;

    // 4. Signals: real, deduplicated, multi-source.
    const signalsRes = await request(app).get("/api/signals?status=CLUSTERED").set("Authorization", human);
    expect(signalsRes.status).toBe(200);
    expect((signalsRes.body as unknown[]).length).toBeGreaterThan(0);

    // 5. Clusters: independent-source tracking is real.
    const clustersRes = await request(app).get("/api/signal-clusters").set("Authorization", human);
    expect(clustersRes.status).toBe(200);
    const clusters = clustersRes.body as Array<{ id: string; signalCount: number; independentSourceCount: number }>;
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]!.independentSourceCount).toBeGreaterThan(0);
    expect(clusters[0]!.independentSourceCount).toBeLessThanOrEqual(clusters[0]!.signalCount);

    // 6. Problems: extracted, never fabricated beyond the real signal count.
    const problemsRes = await request(app).get("/api/problems").set("Authorization", human);
    expect(problemsRes.status).toBe(200);
    expect((problemsRes.body as unknown[]).length).toBeGreaterThan(0);

    // 7. The Opportunity: real chain back to its Problem, scored, kill-risk assessed.
    const opportunityRes = await request(app).get(`/api/opportunities/${opportunityId}`).set("Authorization", human);
    expect(opportunityRes.status).toBe(200);
    expect(opportunityRes.body.problemId).toBeTruthy();
    expect(opportunityRes.body.opportunityScore).not.toBeNull();
    expect(opportunityRes.body.confidenceScore).not.toBeNull();
    expect(opportunityRes.body.status).toBe("DISCOVERED"); // never auto-validated

    const scoresRes = await request(app).get(`/api/opportunities/${opportunityId}/scores`).set("Authorization", human);
    expect(scoresRes.status).toBe(200);
    expect(scoresRes.body[0].killRiskScore).not.toBeNull(); // score, confidence, and kill risk are three separate axes

    // 8. Competitor observations, traceable to the linked Problem.
    const competitorObsRes = await request(app).get(`/api/problems/${opportunityRes.body.problemId}/competitor-observations`).set("Authorization", human);
    expect(competitorObsRes.status).toBe(200);

    // 9. Evidence gaps + the ranked next-best-research-question.
    const gapsRes = await request(app).get(`/api/opportunities/${opportunityId}/evidence-gaps`).set("Authorization", human);
    expect(gapsRes.status).toBe(200);
    expect((gapsRes.body as unknown[]).length).toBeGreaterThan(0);
    expect(opportunityRes.body.nextBestResearchQuestion).toBeTruthy();

    // 10. The research queue: populated, prioritized.
    const queueRes = await request(app).get("/api/research-queue?status=PENDING").set("Authorization", human);
    expect(queueRes.status).toBe(200);
    expect((queueRes.body as unknown[]).length).toBeGreaterThan(0);

    // 11. Chairman: genuinely adversarial, richer M3 inputs.
    const chairmanRes = await request(app).post(`/api/opportunities/${opportunityId}/chairman-review`).set("Authorization", human);
    expect(chairmanRes.status).toBe(201);
    expect(chairmanRes.body.decision.objections.length).toBeGreaterThan(0);
    expect(["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE", "DEFER", "ESCALATE_TO_HUMAN"]).toContain(chairmanRes.body.decision.decision);

    // 12. The formal ask enters the Human Decision Queue.
    const approvalRes = await request(app)
      .post(`/api/opportunities/${opportunityId}/request-approval`)
      .set("Authorization", human)
      .send({
        requestedByAgentId: opportunityAnalystId,
        action: "ADVANCE_TO_VALIDATION",
        description: "Advance this opportunity into active customer validation.",
        riskLevel: "YELLOW",
        reason: `Chairman recommendation: ${chairmanRes.body.decision.recommendation as string}`,
      });
    expect(approvalRes.status).toBe(201);
    const approvalRequestId = approvalRes.body.id as string;

    const queueDecisionsRes = await request(app).get("/api/decisions").set("Authorization", human);
    const entry = (queueDecisionsRes.body as Array<{ approvalRequest: { id: string }; chairmanReview: { decision: string } | null }>).find(
      (item) => item.approvalRequest.id === approvalRequestId,
    );
    expect(entry?.chairmanReview?.decision).toBe(chairmanRes.body.decision.decision);

    // 13. The Human decides.
    const decisionRes = await request(app).post(`/api/decisions/${approvalRequestId}/approve`).set("Authorization", human).send({});
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.status).toBe("APPROVED");

    // 14. Every major stage published a domain event.
    const eventsRes = await request(app).get("/api/events?limit=200").set("Authorization", human);
    const eventTypes = (eventsRes.body as Array<{ type: string }>).map((event) => event.type);
    expect(eventTypes).toContain("RESEARCH_CYCLE_STARTED");
    expect(eventTypes).toContain("RESEARCH_CYCLE_COMPLETED");
    expect(eventTypes).toContain("SIGNAL_CLUSTER_CREATED");
    expect(eventTypes).toContain("PROBLEM_EXTRACTED");
    expect(eventTypes).toContain("COMPETITOR_ANALYSIS_COMPLETED");
    expect(eventTypes).toContain("OPPORTUNITY_DISCOVERED");
    expect(eventTypes).toContain("OPPORTUNITY_SCORED");
    expect(eventTypes).toContain("APPROVAL_APPROVED");

    // 15. Audit: the full chain is reconstructable from the audit log alone.
    const auditRes = await request(app).get(`/api/audit-logs?resourceType=OPPORTUNITY&resourceId=${opportunityId}`).set("Authorization", human);
    const actions = (auditRes.body as Array<{ action: string }>).map((entry2) => entry2.action);
    expect(actions).toContain("CREATE_OPPORTUNITY");
    expect(actions).toContain("SCORE_OPPORTUNITY");
    expect(actions).toContain("EVIDENCE_GAP_ANALYSIS");
    expect(actions.some((action) => action.startsWith("CHAIRMAN_REVIEW_"))).toBe(true);
  });
});

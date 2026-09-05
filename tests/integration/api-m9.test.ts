import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { agentService } from "../../src/services/agent.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { humanOwner } from "../setup.js";

const app = createApp();

async function mintHumanToken(label = "API M9 Test Human"): Promise<string> {
  const { token } = await identityService.createIdentity({ type: "HUMAN", label, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

async function mintAgentToken(label = "API M9 Test Agent"): Promise<string> {
  const agent = await agentService.createAgent({ name: label, role: "Test Role", department: "INTELLIGENCE", description: "x", riskLevel: "GREEN", createdBy: humanOwner });
  const { token } = await identityService.createIdentity({ type: "AGENT", label, agentId: agent.id, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

/**
 * Real HTTP-layer proof that every new M9 route (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §54) actually goes through requireAuth()/requireHuman() — not just a
 * code-review claim. Mirrors api-m5.test.ts/api-m6.test.ts's own
 * discipline: every request below hits the real, unmodified Express app,
 * never a mocked router.
 */
describe("HTTP API — M9 (docs/M9_ARCHITECTURE_PROPOSAL.md §54)", () => {
  it("rejects an unauthenticated request to every new M9 router with 401", async () => {
    for (const path of [
      "/api/control-plane/status",
      "/api/company/state",
      "/api/company/timeline",
      "/api/founder/attention-queue",
      "/api/founder/decisions",
      "/api/decision-quality",
      "/api/learning/records",
      "/api/operating-cycles",
      "/api/alerts",
      "/api/portfolio/overview",
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it("returns 404 for an unknown OperatingCycle / CompanyRecommendation id", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;
    const cycle = await request(app).get("/api/operating-cycles/does-not-exist").set("Authorization", auth);
    expect(cycle.status).toBe(404);
    const rec = await request(app).get("/api/company/recommendations/does-not-exist").set("Authorization", auth);
    expect(rec.status).toBe(404);
  });

  it("every Human-Owner-only M9 endpoint is denied with 403 for an AGENT credential", async () => {
    const agentToken = await mintAgentToken();
    const auth = `Bearer ${agentToken}`;

    const emergencyStop = await request(app).post("/api/control-plane/emergency-stop").set("Authorization", auth).send({ reason: "test" });
    expect(emergencyStop.status).toBe(403);

    const emergencyResume = await request(app).post("/api/control-plane/resume").set("Authorization", auth).send({});
    expect(emergencyResume.status).toBe(403);

    const decideRecommendation = await request(app).post("/api/company/recommendations/does-not-exist/decide").set("Authorization", auth).send({ decision: "APPROVE" });
    expect(decideRecommendation.status).toBe(403);

    const resumeFromAwaitingHuman = await request(app).post("/api/operating-cycles/does-not-exist/resume-from-awaiting-human").set("Authorization", auth).send({ decisionSummary: "x" });
    expect(resumeFromAwaitingHuman.status).toBe(403);

    const pauseCycle = await request(app).post("/api/operating-cycles/does-not-exist/pause").set("Authorization", auth).send({ reason: "x" });
    expect(pauseCycle.status).toBe(403);

    const cancelCycle = await request(app).post("/api/operating-cycles/does-not-exist/cancel").set("Authorization", auth).send({ reason: "x" });
    expect(cancelCycle.status).toBe(403);
  });

  it("an AGENT credential may still start and read OperatingCycles — starting a bounded cycle is not a Human-Owner-only action", async () => {
    const agentToken = await mintAgentToken();
    const auth = `Bearer ${agentToken}`;

    const start = await request(app)
      .post("/api/operating-cycles")
      .set("Authorization", auth)
      .send({ definition: { objective: "x", scope: "x", maxCostUsd: 10, riskLevel: "GREEN", deadline: null, owner: "x" } });
    expect(start.status).toBe(201);

    const list = await request(app).get("/api/operating-cycles").set("Authorization", auth);
    expect(list.status).toBe(200);
  });

  it("rejects a malformed OperatingCycle definition with 400, not a 500", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;
    const res = await request(app)
      .post("/api/operating-cycles")
      .set("Authorization", auth)
      .send({ definition: { objective: "", scope: "x", maxCostUsd: -5, riskLevel: "GREEN", deadline: null, owner: "x" } });
    expect(res.status).toBe(400);
  });
});

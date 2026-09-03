import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { agentService } from "../../src/services/agent.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { humanOwner } from "../setup.js";
import { makeAgentSetWithOpportunity } from "../helpers.js";

const app = createApp();

async function mintHumanToken(label = "API M6 Test Human"): Promise<string> {
  const { token } = await identityService.createIdentity({ type: "HUMAN", label, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

async function mintAgentToken(label = "API M6 Test Agent"): Promise<string> {
  const agent = await agentService.createAgent({ name: label, role: "Test Role", department: "INTELLIGENCE", description: "x", riskLevel: "GREEN", createdBy: humanOwner });
  const { token } = await identityService.createIdentity({ type: "AGENT", label, agentId: agent.id, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

describe("HTTP API — M6 (docs/M6_ARCHITECTURE_PROPOSAL.md §21)", () => {
  it("rejects an unauthenticated request to an M6 route with 401", async () => {
    const res = await request(app).get("/api/products/does-not-exist");
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown product / engineering task / memo", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;
    for (const path of ["/api/products/does-not-exist", "/api/engineering-tasks/does-not-exist", "/api/product-review-memos/does-not-exist"]) {
      const res = await request(app).get(path).set("Authorization", auth);
      expect(res.status).toBe(404);
    }
  });

  it("every privileged, gate-crossing M6 endpoint is Human-Owner-only — an AGENT credential is denied with 403", async () => {
    const agentToken = await mintAgentToken();
    const auth = `Bearer ${agentToken}`;

    const approveProduct = await request(app).post("/api/products/does-not-exist/approve").set("Authorization", auth).send({});
    expect(approveProduct.status).toBe(403);

    const buildProduct = await request(app)
      .post("/api/products/does-not-exist/build")
      .set("Authorization", auth)
      .send({
        strategistAgentId: "x",
        architectAgentId: "x",
        uxAgentId: "x",
        engineeringAgentId: "x",
        codeReviewAgentId: "x",
        qaAgentId: "x",
        securityAgentId: "x",
        ceoAgentId: "x",
      });
    expect(buildProduct.status).toBe(403);

    const decideMemo = await request(app).post("/api/product-review-memos/does-not-exist/decide").set("Authorization", auth).send({ humanDecision: "APPROVE" });
    expect(decideMemo.status).toBe(403);

    const calibrationSummary = await request(app).get("/api/product-review-memos/calibration-summary").set("Authorization", auth);
    expect(calibrationSummary.status).toBe(403);
  });

  it(
    "drives a real Product from creation through a compiled, human-approved memo entirely over HTTP",
    async () => {
      const { agents, opportunity } = await makeAgentSetWithOpportunity();
      const token = await mintHumanToken();
      const auth = `Bearer ${token}`;

      const createRes = await request(app).post("/api/products").set("Authorization", auth).send({ opportunityId: opportunity.id });
      expect(createRes.status).toBe(201);
      const productId = createRes.body.id as string;

      const approveRes = await request(app).post(`/api/products/${productId}/approve`).set("Authorization", auth).send({});
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe("APPROVED");

      const buildRes = await request(app)
        .post(`/api/products/${productId}/build`)
        .set("Authorization", auth)
        .send({
          strategistAgentId: agents.productStrategistAgent.id,
          architectAgentId: agents.mvpArchitectAgent.id,
          uxAgentId: agents.uxAgent.id,
          engineeringAgentId: agents.engineeringAgent.id,
          codeReviewAgentId: agents.codeReviewAgent.id,
          qaAgentId: agents.qaAgent.id,
          securityAgentId: agents.securityReviewAgent.id,
          ceoAgentId: agents.ceoAgent.id,
        });
      expect(buildRes.status).toBe(201);
      expect(buildRes.body.product.status).toBe("HUMAN_REVIEW");
      const memoId = buildRes.body.memo.id as string;

      const specRes = await request(app).get(`/api/products/${productId}/spec`).set("Authorization", auth);
      expect(specRes.status).toBe(200);
      expect(specRes.body.productId).toBe(productId);

      const tasksRes = await request(app).get(`/api/products/${productId}/engineering-tasks`).set("Authorization", auth);
      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body).toHaveLength(2);
      const taskId = tasksRes.body[0].id as string;

      const codeReviewsRes = await request(app).get(`/api/engineering-tasks/${taskId}/code-reviews`).set("Authorization", auth);
      expect(codeReviewsRes.status).toBe(200);
      expect(codeReviewsRes.body.length).toBeGreaterThan(0);

      const decideRes = await request(app).post(`/api/product-review-memos/${memoId}/decide`).set("Authorization", auth).send({ humanDecision: "APPROVE" });
      expect(decideRes.status).toBe(200);
      expect(decideRes.body.humanDecision).toBe("APPROVE");

      const finalProductRes = await request(app).get(`/api/products/${productId}`).set("Authorization", auth);
      expect(finalProductRes.body.status).toBe("READY_FOR_DEPLOYMENT");
    },
    { timeout: 120_000 },
  );
});

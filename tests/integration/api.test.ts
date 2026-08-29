import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { identityService } from "../../src/services/identity.service.js";
import { humanOwner } from "../setup.js";

const app = createApp();

/**
 * tests/setup.ts already bootstraps one HUMAN identity (`humanOwner`)
 * before every test, so the identities table is never empty here —
 * the raw-HTTP bootstrap-from-scratch path is covered separately in
 * tests/integration/authentication.test.ts. This mints an *additional*
 * HUMAN credential the normal way (an existing Human Owner creating
 * one), which is exactly what a real second HTTP client would need.
 */
async function mintHumanToken(label = "API Test Human"): Promise<string> {
  const { token } = await identityService.createIdentity({
    type: "HUMAN",
    label,
    createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId },
  });
  return token;
}

describe("HTTP API", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("AUTHENTICATION_ERROR");
  });

  it("drives the vertical slice through the HTTP API", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;

    const agentRes = await request(app).post("/api/agents").set("Authorization", auth).send({
      name: "API Test Agent",
      role: "Research Agent",
      department: "INTELLIGENCE",
      description: "x",
      riskLevel: "GREEN",
    });
    expect(agentRes.status).toBe(201);
    const agentId = agentRes.body.id as string;

    const signalRes = await request(app)
      .post("/api/research-signals")
      .set("Authorization", auth)
      .send({
        agentId,
        opportunity: {
          title: "Automated invoice chasing",
          problem: "Freelancers lose money to late payments.",
          targetCustomer: "Freelancers",
          description: "Automated follow-ups.",
        },
        evidence: [
          {
            claim: "Late payments are a common complaint.",
            source: "Reddit analysis",
            sourceType: "WEB",
            reliability: "LOW",
            confidence: 0.4,
          },
        ],
        scoreDimensions: {
          pain: 0.7,
          demand: 0.6,
          willingnessToPay: 0.5,
          reachability: 0.5,
          retention: 0.5,
          differentiation: 0.4,
          buildability: 0.7,
          economics: 0.5,
          risk: 0.4,
          evidenceQuality: 0.4,
        },
        approvalRequest: {
          action: "ADVANCE_TO_VALIDATION",
          description: "Approve validation spend.",
          riskLevel: "YELLOW",
        },
      });
    expect(signalRes.status).toBe(201);
    const approvalRequestId = signalRes.body.approvalRequest.id as string;

    const queueRes = await request(app).get("/api/decisions").set("Authorization", auth);
    expect(queueRes.status).toBe(200);
    const queueIds = (queueRes.body as Array<{ approvalRequest: { id: string } }>).map((e) => e.approvalRequest.id);
    expect(queueIds).toContain(approvalRequestId);

    const approveRes = await request(app).post(`/api/decisions/${approvalRequestId}/approve`).set("Authorization", auth).send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
  });

  it("rejects an invalid request body with 400", async () => {
    const token = await mintHumanToken();
    const res = await request(app).post("/api/agents").set("Authorization", `Bearer ${token}`).send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown agent", async () => {
    const token = await mintHumanToken();
    const res = await request(app).get("/api/agents/does-not-exist").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("an agent cannot grant itself a permission over HTTP, even using its own real credential", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;

    const agentRes = await request(app).post("/api/agents").set("Authorization", auth).send({
      name: "Self Grant Attempt",
      role: "x",
      department: "OPERATIONS",
      description: "x",
      riskLevel: "GREEN",
    });
    const agentId = agentRes.body.id as string;

    const agentIdentityRes = await request(app)
      .post("/api/identities")
      .set("Authorization", auth)
      .send({ type: "AGENT", label: "self", agentId });
    expect(agentIdentityRes.status).toBe(201);
    const agentToken = agentIdentityRes.body.token as string;

    const grantRes = await request(app)
      .post(`/api/agents/${agentId}/permissions`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ permission: "SPEND_MONEY" });
    expect(grantRes.status).toBe(403);
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();

describe("HTTP API", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("drives the vertical slice through the HTTP API", async () => {
    const agentRes = await request(app).post("/api/agents").send({
      name: "API Test Agent",
      role: "Research Agent",
      department: "INTELLIGENCE",
      description: "x",
      riskLevel: "GREEN",
      createdBy: "founder",
    });
    expect(agentRes.status).toBe(201);
    const agentId = agentRes.body.id as string;

    const signalRes = await request(app)
      .post("/api/research-signals")
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

    const queueRes = await request(app).get("/api/decisions");
    expect(queueRes.status).toBe(200);
    const queueIds = (queueRes.body as Array<{ approvalRequest: { id: string } }>).map((e) => e.approvalRequest.id);
    expect(queueIds).toContain(approvalRequestId);

    const approveRes = await request(app).post(`/api/decisions/${approvalRequestId}/approve`).send({ reviewedBy: "founder" });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
  });

  it("rejects an invalid request body with 400", async () => {
    const res = await request(app).post("/api/agents").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown agent", async () => {
    const res = await request(app).get("/api/agents/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("an agent cannot grant itself a permission over HTTP (403)", async () => {
    const agentRes = await request(app).post("/api/agents").send({
      name: "Self Grant Attempt",
      role: "x",
      department: "OPERATIONS",
      description: "x",
      riskLevel: "GREEN",
      createdBy: "founder",
    });
    const agentId = agentRes.body.id as string;

    const grantRes = await request(app)
      .post(`/api/agents/${agentId}/permissions`)
      .send({ permission: "SPEND_MONEY", grantedBy: agentId });
    expect(grantRes.status).toBe(403);
  });
});

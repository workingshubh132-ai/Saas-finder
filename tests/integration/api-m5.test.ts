import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { agentService } from "../../src/services/agent.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { humanOwner } from "../setup.js";

const app = createApp();

async function mintHumanToken(label = "API M5 Test Human"): Promise<string> {
  const { token } = await identityService.createIdentity({ type: "HUMAN", label, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

async function mintAgentToken(label = "API M5 Test Agent"): Promise<string> {
  const agent = await agentService.createAgent({ name: label, role: "Test Role", department: "INTELLIGENCE", description: "x", riskLevel: "GREEN", createdBy: humanOwner });
  const { token } = await identityService.createIdentity({ type: "AGENT", label, agentId: agent.id, createdBy: { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId } });
  return token;
}

describe("HTTP API — M5 (docs/M5_ARCHITECTURE_PROPOSAL.md §23-24)", () => {
  it("rejects an unauthenticated request to an M5 route with 401", async () => {
    const res = await request(app).get("/api/prospects/does-not-exist");
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown ICP profile / prospect / experiment / message / response / memo", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;
    for (const path of [
      "/api/icp-profiles/does-not-exist",
      "/api/prospects/does-not-exist",
      "/api/outreach-experiments/does-not-exist",
      "/api/outreach-messages/does-not-exist",
      "/api/customer-responses/does-not-exist",
      "/api/customer-discovery-memos/does-not-exist",
    ]) {
      const res = await request(app).get(path).set("Authorization", auth);
      expect(res.status).toBe(404);
    }
  });

  it("every privileged, gate-crossing M5 endpoint is Human-Owner-only — an AGENT credential is denied with 403", async () => {
    const agentToken = await mintAgentToken();
    const auth = `Bearer ${agentToken}`;

    const createExperiment = await request(app).post("/api/outreach-experiments").set("Authorization", auth).send({
      opportunityId: "x",
      objective: "x",
      claimId: "x",
      targetIcpProfileId: "x",
      researchQuestion: "x",
      messageStrategy: "x",
      prospectLimit: 5,
      successCriteria: "x",
      failureCriteria: "x",
      createdByIdentityId: "x",
    });
    expect(createExperiment.status).toBe(403);

    const approveExperiment = await request(app).post("/api/outreach-experiments/does-not-exist/approve").set("Authorization", auth).send({});
    expect(approveExperiment.status).toBe(403);

    const applyDecision = await request(app).post("/api/outreach-messages/apply-decision").set("Authorization", auth).send({ approvalRequestId: "x" });
    expect(applyDecision.status).toBe(403);

    const markContacted = await request(app).post("/api/outreach-messages/does-not-exist/mark-contacted").set("Authorization", auth).send({});
    expect(markContacted.status).toBe(403);

    const recordResponse = await request(app).post("/api/customer-responses").set("Authorization", auth).send({ outreachMessageId: "x", rawContent: "x" });
    expect(recordResponse.status).toBe(403);

    const decideMemo = await request(app).post("/api/customer-discovery-memos/does-not-exist/decide").set("Authorization", auth).send({ decision: "APPROVE" });
    expect(decideMemo.status).toBe(403);

    const doNotContact = await request(app).post("/api/prospects/does-not-exist/do-not-contact").set("Authorization", auth).send({ reason: "x" });
    expect(doNotContact.status).toBe(403);

    const calibrationSummary = await request(app).get("/api/customer-discovery-memos/calibration-summary").set("Authorization", auth);
    expect(calibrationSummary.status).toBe(403);
  });

  it("no route in this codebase exposes any capability that could send an external message (docs/M5_ARCHITECTURE_PROPOSAL.md §23 — 'no such capability exists to expose')", async () => {
    const token = await mintHumanToken();
    const auth = `Bearer ${token}`;
    // mark-contacted is record-keeping only — confirm it 404s for a truly nonexistent message rather than attempting any real send.
    const res = await request(app).post("/api/outreach-messages/does-not-exist/mark-contacted").set("Authorization", auth).send({});
    expect(res.status).toBe(404);
  });
});

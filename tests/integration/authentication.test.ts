import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { prisma } from "../../src/db/client.js";
import type { AuthenticatedActor } from "../../src/domain/identity/identity.types.js";
import { AuthenticationError } from "../../src/domain/shared/errors.js";
import { agentService } from "../../src/services/agent.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { humanOwner } from "../setup.js";

const app = createApp();

function toAuthenticatedActor(actor: { actorType: "HUMAN"; actorId: string }): AuthenticatedActor {
  return { type: actor.actorType, id: actor.actorId, identityId: actor.actorId };
}

describe("authentication", () => {
  it("bootstraps the first HUMAN identity only when the identities table is truly empty", async () => {
    // tests/setup.ts already bootstrapped `humanOwner` — clear it to
    // simulate a genuinely fresh deployment for this one test.
    await prisma.identity.deleteMany();

    const created = await identityService.createIdentity({ type: "HUMAN", label: "Fresh Bootstrap", createdBy: null });
    expect(created.identity.type).toBe("HUMAN");
    expect(created.token).toMatch(/^vf_/);

    // The bootstrap window is now closed — a second unauthenticated create must fail.
    await expect(identityService.createIdentity({ type: "HUMAN", label: "Second", createdBy: null })).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("rejects a non-HUMAN type for the bootstrap identity", async () => {
    await prisma.identity.deleteMany();
    await expect(identityService.createIdentity({ type: "SYSTEM", label: "x", createdBy: null })).rejects.toThrow();
  });

  it("a valid token authenticates to the correct actor type", async () => {
    const { token } = await identityService.createIdentity({
      type: "SYSTEM",
      label: "scheduler",
      createdBy: toAuthenticatedActor(humanOwner),
    });
    const actor = await identityService.authenticate(token);
    expect(actor.type).toBe("SYSTEM");
  });

  it("an AGENT token resolves to the linked Agent's id, not the identity's own id", async () => {
    const agent = await agentService.createAgent({
      name: "Cred Test Agent",
      role: "x",
      department: "INTELLIGENCE",
      description: "x",
      riskLevel: "GREEN",
      createdBy: humanOwner,
    });
    const { identity, token } = await identityService.createIdentity({
      type: "AGENT",
      label: "agent credential",
      agentId: agent.id,
      createdBy: toAuthenticatedActor(humanOwner),
    });

    const actor = await identityService.authenticate(token);
    expect(actor.type).toBe("AGENT");
    expect(actor.id).toBe(agent.id);
    expect(actor.id).not.toBe(identity.id);
    expect(actor.identityId).toBe(identity.id);
  });

  it("an invalid (unknown) token is rejected", async () => {
    await expect(identityService.authenticate("vf_not-a-real-token")).rejects.toThrow(AuthenticationError);
  });

  it("a revoked token is rejected", async () => {
    const { identity, token } = await identityService.createIdentity({
      type: "SYSTEM",
      label: "to be revoked",
      createdBy: toAuthenticatedActor(humanOwner),
    });
    await identityService.revokeIdentity({ id: identity.id, revokedBy: toAuthenticatedActor(humanOwner) });

    await expect(identityService.authenticate(token)).rejects.toThrow(AuthenticationError);
  });

  it("an expired token is rejected", async () => {
    const { token } = await identityService.createIdentity({
      type: "SYSTEM",
      label: "expiring",
      createdBy: toAuthenticatedActor(humanOwner),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(identityService.authenticate(token)).rejects.toThrow(AuthenticationError);
  });

  it("creating a non-bootstrap identity requires an authenticated HUMAN — an AGENT credential cannot", async () => {
    const agent = await agentService.createAgent({
      name: "No Escalation Agent",
      role: "x",
      department: "INTELLIGENCE",
      description: "x",
      riskLevel: "GREEN",
      createdBy: humanOwner,
    });
    const { token: agentToken } = await identityService.createIdentity({
      type: "AGENT",
      label: "agent credential",
      agentId: agent.id,
      createdBy: toAuthenticatedActor(humanOwner),
    });
    const agentActor = await identityService.authenticate(agentToken);

    await expect(identityService.createIdentity({ type: "SYSTEM", label: "escalation attempt", createdBy: agentActor })).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("HTTP: a missing credential is rejected with 401 AUTHENTICATION_ERROR", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("AUTHENTICATION_ERROR");
  });

  it("HTTP: an invalid credential is rejected with 401", async () => {
    const res = await request(app).get("/api/agents").set("Authorization", "Bearer garbage-token");
    expect(res.status).toBe(401);
  });

  it("HTTP: a valid non-HUMAN credential is rejected by a HUMAN-only route with 403, not 401", async () => {
    const { token } = await identityService.createIdentity({
      type: "SYSTEM",
      label: "scheduler",
      createdBy: toAuthenticatedActor(humanOwner),
    });
    const res = await request(app).get("/api/decisions").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("AUTHORIZATION_ERROR");
  });
});

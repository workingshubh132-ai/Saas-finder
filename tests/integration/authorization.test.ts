import { describe, expect, it } from "vitest";
import { NotHumanOwnerError, ValidationError } from "../../src/domain/shared/errors.js";
import { agentService } from "../../src/services/agent.service.js";
import { authorizationService } from "../../src/services/authorization.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

describe("authorizationService.authorize", () => {
  it("allows a GREEN action once the agent holds an active grant", async () => {
    const agent = await makeAgent({ riskLevel: "GREEN" });
    await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "READ_WEB" });

    expect(decision.decision).toBe("ALLOWED");
    expect(decision.riskLevel).toBe("GREEN");
  });

  it("denies an action the agent was never granted", async () => {
    const agent = await makeAgent();

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "SEND_EXTERNAL_MESSAGE" });

    expect(decision.decision).toBe("DENIED");
  });

  it("requires approval for a YELLOW action even when granted", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "SEND_EXTERNAL_MESSAGE", grantedBy: HUMAN_OWNER });

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "SEND_EXTERNAL_MESSAGE" });

    expect(decision.decision).toBe("REQUIRES_APPROVAL");
    expect(decision.riskLevel).toBe("YELLOW");
  });

  it("requires approval for an ORANGE action (Chairman + Human governance)", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "MODIFY_CONFIGURATION", grantedBy: HUMAN_OWNER });

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "MODIFY_CONFIGURATION" });

    expect(decision.decision).toBe("REQUIRES_APPROVAL");
    expect(decision.riskLevel).toBe("ORANGE");
  });

  it("requires approval for a RED action, which the policy also marks as never auto-executable", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "SPEND_MONEY", grantedBy: HUMAN_OWNER });

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "SPEND_MONEY" });

    expect(decision.decision).toBe("REQUIRES_APPROVAL");
    expect(decision.riskLevel).toBe("RED");
  });

  it("fails closed for an unknown action", async () => {
    const agent = await makeAgent();
    const decision = await authorizationService.authorize({ agentId: agent.id, action: "HACK_THE_MAINFRAME" });
    expect(decision.decision).toBe("DENIED");
    expect(decision.riskLevel).toBeNull();
  });

  it("fails closed for an unknown agent", async () => {
    const decision = await authorizationService.authorize({ agentId: "does-not-exist", action: "READ_WEB" });
    expect(decision.decision).toBe("DENIED");
  });

  it("denies a suspended agent even with an active grant", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
    await agentService.transitionStatus({
      id: agent.id,
      toStatus: "SUSPENDED",
      actor: { actorType: "HUMAN", actorId: HUMAN_OWNER },
    });

    const decision = await authorizationService.authorize({ agentId: agent.id, action: "READ_WEB" });

    expect(decision.decision).toBe("DENIED");
  });

  it("an agent cannot grant itself a permission", async () => {
    const agent = await makeAgent();
    await expect(
      agentService.grantPermission({ agentId: agent.id, permission: "SPEND_MONEY", grantedBy: agent.id }),
    ).rejects.toThrow(NotHumanOwnerError);
  });

  it("rejects creating an agent with an unknown risk level", async () => {
    await expect(
      agentService.createAgent({
        name: "Bad Agent",
        role: "x",
        department: "INTELLIGENCE",
        description: "x",
        riskLevel: "MAGENTA",
        createdBy: HUMAN_OWNER,
      }),
    ).rejects.toThrow(ValidationError);
  });
});

import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { auditService } from "../../src/services/audit.service.js";
import { authorizationService } from "../../src/services/authorization.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

describe("audit trail", () => {
  it("records agent creation", async () => {
    const agent = await makeAgent();
    const entries = await auditService.list({ resourceType: "AGENT", resourceId: agent.id });
    expect(entries.some((entry) => entry.action === "CREATE_AGENT")).toBe(true);
    expect(entries[0]?.actorType).toBe("HUMAN");
  });

  it("records a permission grant", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });

    const entries = await auditService.list({ resourceType: "AGENT", resourceId: agent.id });
    expect(entries.some((entry) => entry.action === "GRANT_PERMISSION")).toBe(true);
  });

  it("records a denied authorization decision with result DENIED", async () => {
    const agent = await makeAgent();
    await authorizationService.authorize({ agentId: agent.id, action: "SPEND_MONEY" });

    const entries = await auditService.list({ actorId: agent.id });
    const authEntry = entries.find((entry) => entry.action === "AUTHORIZE:SPEND_MONEY");
    expect(authEntry?.result).toBe("DENIED");
  });

  it("records a successful requires-approval authorization decision, with its risk level", async () => {
    const agent = await makeAgent();
    await agentService.grantPermission({ agentId: agent.id, permission: "SPEND_MONEY", grantedBy: HUMAN_OWNER });
    await authorizationService.authorize({ agentId: agent.id, action: "SPEND_MONEY" });

    const entries = await auditService.list({ actorId: agent.id });
    const authEntry = entries.find((entry) => entry.action === "AUTHORIZE:SPEND_MONEY");
    expect(authEntry?.result).toBe("SUCCESS");
    expect(authEntry?.riskLevel).toBe("RED");
  });
});

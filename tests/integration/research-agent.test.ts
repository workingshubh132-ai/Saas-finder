import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { researchAgentService } from "../../src/services/research-agent.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

function startedBy() {
  return { type: "HUMAN" as const, id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId };
}

async function authorizedResearchAgent() {
  const agent = await makeAgent({ role: "Research Agent" });
  await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  return agent;
}

describe("researchAgentService", () => {
  it("takes an objective, uses its permitted tool, and produces structured findings", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find recurring problems experienced by small businesses that could be solved with SaaS",
      startedBy: startedBy(),
    });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.synthesis.findings.length).toBeGreaterThan(0);
    for (const finding of outcome.result?.synthesis.findings ?? []) {
      expect(finding.confidence).toBeGreaterThanOrEqual(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
      expect(finding.sourceReference.length).toBeGreaterThan(0);
    }
  });

  it("preserves source provenance — every finding's evidence keeps a real sourceReference and the collecting agent", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });
    expect(outcome.status).toBe("COMPLETED");
    const opportunityId = outcome.result!.opportunityId;

    const evidence = await opportunityService.listEvidence(opportunityId);
    expect(evidence.length).toBe(outcome.result!.synthesis.findings.length);
    for (const item of evidence) {
      expect(item.collectedByAgentId).toBe(agent.id);
      expect(item.sourceReference).not.toBeNull();
      expect(item.source).toBe("Hacker News Search");
      expect(item.verificationStatus).toBe("UNVERIFIED"); // never claims verification it hasn't earned
    }
  });

  it("creates the Opportunity but never auto-validates it — status stays DISCOVERED, validation level stays LEVEL_0", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });
    expect(outcome.status).toBe("COMPLETED");

    const opportunity = await opportunityService.getOrThrow(outcome.result!.opportunityId);
    expect(opportunity.status).toBe("DISCOVERED");
    expect(opportunity.validationLevel).toBe("LEVEL_0");
    expect(opportunity.opportunityScore).not.toBeNull();
    expect(opportunity.confidenceScore).not.toBeNull();
  });

  it("is denied when the agent lacks READ_WEB — fails closed, no opportunity is created", async () => {
    const agent = await makeAgent({ role: "Research Agent" }); // no grant

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity",
      startedBy: startedBy(),
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("AUTHORIZATION_ERROR");
    expect(outcome.result).toBeNull();

    const opportunities = await opportunityService.listOpportunities({});
    expect(opportunities).toHaveLength(0);
  });

  it("stays within its bounded pipeline — at most 3 tool calls and 2 model calls for one objective", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });

    expect(outcome.execution.toolCallCount).toBeLessThanOrEqual(3);
    expect(outcome.execution.modelCallCount).toBeLessThanOrEqual(2);
  });
});

import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { signalService } from "../../src/services/signal.service.js";
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

/**
 * M3 CHANGE (docs/M3_ARCHITECTURE_PROPOSAL.md §1, §9): the Research
 * Agent now only collects normalized Signal rows — it no longer
 * synthesizes findings or creates Evidence/Opportunity directly (that
 * was M2's design; M3 brief Part 3 explicitly forbids a single signal
 * automatically becoming an opportunity). See
 * tests/unit/signal-quality.test.ts, tests/integration/signal.test.ts,
 * and tests/integration/m3-end-to-end.test.ts for what happens to
 * those signals downstream.
 */
describe("researchAgentService", () => {
  it("takes an objective, uses its permitted tools, and produces normalized signals", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find recurring problems experienced by small businesses that could be solved with SaaS",
      startedBy: startedBy(),
    });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.signalsIngested).toBeGreaterThan(0);
    expect(outcome.result?.signalIds.length).toBe(outcome.result?.signalsIngested);
  });

  it("preserves source provenance — every ingested signal keeps a real sourceReference and the collecting agent", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });
    expect(outcome.status).toBe("COMPLETED");

    for (const signalId of outcome.result!.signalIds) {
      const signal = await signalService.getOrThrow(signalId);
      expect(signal.collectedByAgentId).toBe(agent.id);
      expect(signal.sourceReference).toBeTruthy();
      expect(["hacker_news", "stack_exchange"]).toContain(signal.source);
    }
  });

  it("rounds queries across every registered source tool, drawing on more than one source", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });
    expect(outcome.status).toBe("COMPLETED");

    const sourcesUsed = new Set<string>();
    for (const signalId of outcome.result!.signalIds) {
      const signal = await signalService.getOrThrow(signalId);
      sourcesUsed.add(signal.source);
    }
    // The default dev-mode plan fixture produces 3 queries, round-robined
    // across 2 registered sources, so both are exercised in one run.
    expect(sourcesUsed.size).toBeGreaterThanOrEqual(2);
  });

  it("is denied when the agent lacks READ_WEB — fails closed, no signal is created", async () => {
    const agent = await makeAgent({ role: "Research Agent" }); // no grant

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity",
      startedBy: startedBy(),
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("AUTHORIZATION_ERROR");
    expect(outcome.result).toBeNull();
  });

  it("stays within its bounded pipeline — at most 3 tool calls and 1 model call for one objective", async () => {
    const agent = await authorizedResearchAgent();

    const outcome = await researchAgentService.run({
      agentId: agent.id,
      objective: "Find a promising SaaS opportunity for small businesses",
      startedBy: startedBy(),
    });

    expect(outcome.execution.toolCallCount).toBeLessThanOrEqual(3);
    expect(outcome.execution.modelCallCount).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { researchCycleService } from "../../src/services/research-cycle.service.js";
import { authActor, makeAgent, HUMAN_OWNER } from "../helpers.js";

async function makeCycleAgents() {
  const researchAgent = await makeAgent({ role: "Research Agent" });
  await agentService.grantPermission({ agentId: researchAgent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  const problemAnalystAgent = await makeAgent({ role: "Problem Analyst" });
  const competitorAnalystAgent = await makeAgent({ role: "Competitor Analyst" });
  await agentService.grantPermission({ agentId: competitorAnalystAgent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  const marketAnalystAgent = await makeAgent({ role: "Market Analyst" });
  const opportunityAnalystAgent = await makeAgent({ role: "Opportunity Analyst" });
  return { researchAgent, problemAnalystAgent, competitorAnalystAgent, marketAnalystAgent, opportunityAnalystAgent };
}

describe("researchCycleService.run", () => {
  it("drives the full pipeline end to end: signals -> cluster -> problem -> competitor/market -> opportunity -> queue", async () => {
    const agents = await makeCycleAgents();

    const summary = await researchCycleService.run({
      objective: "Find recurring problems experienced by small businesses that may support a focused SaaS product.",
      researchAgentId: agents.researchAgent.id,
      problemAnalystAgentId: agents.problemAnalystAgent.id,
      competitorAnalystAgentId: agents.competitorAnalystAgent.id,
      marketAnalystAgentId: agents.marketAnalystAgent.id,
      opportunityAnalystAgentId: agents.opportunityAnalystAgent.id,
      startedBy: authActor(),
    });

    expect(summary.cycle.status).toBe("COMPLETED");
    expect(summary.signalsCollected).toBeGreaterThan(0);
    expect(summary.clustersTouched).toBeGreaterThan(0);
    expect(summary.opportunitiesGenerated.length).toBeGreaterThan(0);

    const { researchQueueService } = await import("../../src/services/research-queue.service.js");
    const queued = await researchQueueService.list({ status: "PENDING" });
    expect(queued.length).toBeGreaterThan(0);
  });

  it("lands in AWAITING_HUMAN, not a crash, when the Research Agent lacks its required grant", async () => {
    const agents = await makeCycleAgents();
    const ungrantedResearchAgent = await makeAgent({ role: "Research Agent" }); // no READ_WEB grant

    const summary = await researchCycleService.run({
      objective: "test",
      researchAgentId: ungrantedResearchAgent.id,
      problemAnalystAgentId: agents.problemAnalystAgent.id,
      competitorAnalystAgentId: agents.competitorAnalystAgent.id,
      marketAnalystAgentId: agents.marketAnalystAgent.id,
      opportunityAnalystAgentId: agents.opportunityAnalystAgent.id,
      startedBy: authActor(),
    });

    expect(summary.cycle.status).toBe("AWAITING_HUMAN");
    expect(summary.opportunitiesGenerated).toHaveLength(0);
  });

  it("stops cleanly within budget and keeps every already-committed row — never rolls back partial work (Part 38)", async () => {
    const agents = await makeCycleAgents();

    const summary = await researchCycleService.run({
      objective: "Find recurring problems experienced by small businesses.",
      researchAgentId: agents.researchAgent.id,
      problemAnalystAgentId: agents.problemAnalystAgent.id,
      competitorAnalystAgentId: agents.competitorAnalystAgent.id,
      marketAnalystAgentId: agents.marketAnalystAgent.id,
      opportunityAnalystAgentId: agents.opportunityAnalystAgent.id,
      startedBy: authActor(),
      budgetOverrides: { maxModelCalls: 1 }, // enough for PLAN, not enough for problem extraction onward
    });

    expect(summary.cycle.status).toBe("STOPPED");
    expect(summary.cycle.stoppedReason).toBeTruthy();
    expect(summary.signalsCollected).toBeGreaterThan(0); // signal collection still completed and was saved

    const { signalService } = await import("../../src/services/signal.service.js");
    const persisted = await signalService.list({});
    expect(persisted.length).toBeGreaterThan(0); // the signals are really in the database, not discarded
  });

  it("a second cycle resolves the highest-priority queue item from the first, rather than blindly re-researching", async () => {
    const agents = await makeCycleAgents();
    const first = await researchCycleService.run({
      objective: "Find recurring problems experienced by small businesses.",
      researchAgentId: agents.researchAgent.id,
      problemAnalystAgentId: agents.problemAnalystAgent.id,
      competitorAnalystAgentId: agents.competitorAnalystAgent.id,
      marketAnalystAgentId: agents.marketAnalystAgent.id,
      opportunityAnalystAgentId: agents.opportunityAnalystAgent.id,
      startedBy: authActor(),
    });
    expect(first.cycle.status).toBe("COMPLETED");

    const { researchQueueService } = await import("../../src/services/research-queue.service.js");
    const topPriorityItem = await researchQueueService.next();
    expect(topPriorityItem).not.toBeNull();

    const second = await researchCycleService.run({
      objective: "fallback objective — should not be used while a queue item is pending",
      researchAgentId: agents.researchAgent.id,
      problemAnalystAgentId: agents.problemAnalystAgent.id,
      competitorAnalystAgentId: agents.competitorAnalystAgent.id,
      marketAnalystAgentId: agents.marketAnalystAgent.id,
      opportunityAnalystAgentId: agents.opportunityAnalystAgent.id,
      startedBy: authActor(),
    });

    expect(second.cycle.objective).toBe(topPriorityItem?.reason);
  });
});

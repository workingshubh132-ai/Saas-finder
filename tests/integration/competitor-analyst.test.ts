import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { competitorAnalystService } from "../../src/services/competitor-analyst.service.js";
import { authActor, makeAgent, makeProblem, HUMAN_OWNER } from "../helpers.js";

async function authorizedCompetitorAnalyst() {
  const agent = await makeAgent({ role: "Competitor Analyst" });
  await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  return agent;
}

describe("competitorAnalystService", () => {
  it("finds and persists competitor observations grounded in real search results, reusable across problems", async () => {
    const agent = await authorizedCompetitorAnalyst();
    const problem = await makeProblem();

    const outcome = await competitorAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.observations.length).toBeGreaterThan(0);
    for (const observation of outcome.result?.observations ?? []) {
      expect(observation.problemId).toBe(problem.id);
      expect(observation.competitor.name).toBeTruthy();
      expect(observation.detail).toBeTruthy();
    }
  });

  it("is denied when the agent lacks READ_WEB — fails closed, no observation is created", async () => {
    const agent = await makeAgent({ role: "Competitor Analyst" }); // no grant
    const problem = await makeProblem();

    const outcome = await competitorAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("AUTHORIZATION_ERROR");
  });

  it("stays within its bounded budget — exactly one tool call, at most one model call", async () => {
    const agent = await authorizedCompetitorAnalyst();
    const problem = await makeProblem();

    const outcome = await competitorAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.execution.toolCallCount).toBe(1);
    expect(outcome.execution.modelCallCount).toBeLessThanOrEqual(1);
  });
});

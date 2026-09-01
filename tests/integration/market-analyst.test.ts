import { describe, expect, it } from "vitest";
import { marketAnalystService } from "../../src/services/market-analyst.service.js";
import { authActor, makeAgent, makeProblem } from "../helpers.js";

describe("marketAnalystService", () => {
  it("produces WTP signals and a market read, grounded in the Problem's own fields", async () => {
    const agent = await makeAgent({ role: "Market Analyst" });
    const problem = await makeProblem({ willingnessToPaySignal: "Some businesses pay for partial tools already" });

    const outcome = await marketAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.marketTiming).toBeTruthy();
    expect(outcome.result?.marketSizeQualitative).toBeTruthy();
  });

  it("reports zero WTP signals honestly when the Problem has none — never invents one (Part 18)", async () => {
    const agent = await makeAgent({ role: "Market Analyst" });
    const problem = await makeProblem({ willingnessToPaySignal: "No explicit willingness-to-pay signal found." });

    const outcome = await marketAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.wtpSignals).toHaveLength(0);
  });

  it("needs no tool call — reasoning only", async () => {
    const agent = await makeAgent({ role: "Market Analyst" }); // no permission grants at all
    const problem = await makeProblem();

    const outcome = await marketAnalystService.run({ agentId: agent.id, problemId: problem.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED"); // no Guardian check to fail — no tool is used
    expect(outcome.execution.toolCallCount).toBe(0);
  });
});

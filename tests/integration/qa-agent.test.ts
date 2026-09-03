import { describe, expect, it } from "vitest";
import { qaAgentService } from "../../src/services/qa-agent.service.js";
import { qaReportRepository } from "../../src/db/repositories/qa-report.repository.js";
import { auditService } from "../../src/services/audit.service.js";
import { authActor, makeCompletedEngineeringTask } from "../helpers.js";

describe("qaAgentService.run", () => {
  it("finds the real store task's test coverage adequate — genuinely counted, not assumed", async () => {
    const { agents, storeTask } = await makeCompletedEngineeringTask();

    const outcome = await qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.qaReport.verdict).toBe("PASS");
    expect(JSON.parse(outcome.result.qaReport.missingTests)).toEqual([]);

    const stored = await qaReportRepository.findLatestForTask(storeTask.id);
    expect(stored?.id).toBe(outcome.result.qaReport.id);

    const entries = await auditService.list({ resourceType: "ENGINEERING_TASK", resourceId: storeTask.id });
    expect(entries.some((e) => e.action === "CREATE_QA_REPORT")).toBe(true);
  });

  it("refuses to run against a task that has not completed implementation yet", async () => {
    const { agents, apiTask } = await makeCompletedEngineeringTask();
    await expect(qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: apiTask.id, startedBy: authActor() })).rejects.toThrow(/only runs against a COMPLETED/);
  });
});

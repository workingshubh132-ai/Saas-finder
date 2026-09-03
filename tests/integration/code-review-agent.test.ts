import { describe, expect, it } from "vitest";
import { codeReviewAgentService } from "../../src/services/code-review-agent.service.js";
import { codeReviewRepository } from "../../src/db/repositories/code-review.repository.js";
import { engineeringTaskService } from "../../src/services/engineering-task.service.js";
import { auditService } from "../../src/services/audit.service.js";
import { authActor, makeCompletedEngineeringTask } from "../helpers.js";

describe("codeReviewAgentService.run", () => {
  it("reviews the real, typechecked store implementation and finds it clean — an honest review, not a manufactured one", async () => {
    const { agents, storeTask } = await makeCompletedEngineeringTask();

    const outcome = await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.codeReview.hasBlockingFinding).toBe(false);
    const findings = JSON.parse(outcome.result.codeReview.findings);
    expect(Array.isArray(findings)).toBe(true);

    const stored = await codeReviewRepository.findLatestForTask(storeTask.id);
    expect(stored?.id).toBe(outcome.result.codeReview.id);

    const entries = await auditService.list({ resourceType: "ENGINEERING_TASK", resourceId: storeTask.id });
    expect(entries.some((e) => e.action === "CREATE_CODE_REVIEW")).toBe(true);
  });

  it("refuses to review a task that has not completed implementation yet", async () => {
    const { agents, apiTask } = await makeCompletedEngineeringTask();
    // apiTask is still PENDING — its dependency (storeTask) is done, but it has not been implemented itself.
    await expect(codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: apiTask.id, startedBy: authActor() })).rejects.toThrow(/only runs against a COMPLETED/);
  });

  it("never changes the EngineeringTask's own status — code review is a separate, layered judgment", async () => {
    const { agents, storeTask } = await makeCompletedEngineeringTask();

    const outcome = await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");

    const refetched = await engineeringTaskService.getOrThrow(storeTask.id);
    expect(refetched.status).toBe("COMPLETED");
    expect(refetched.updatedAt).toEqual(storeTask.updatedAt);
  });
});

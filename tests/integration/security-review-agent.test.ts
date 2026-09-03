import { describe, expect, it } from "vitest";
import { securityReviewAgentService } from "../../src/services/security-review-agent.service.js";
import { securityReviewRepository } from "../../src/db/repositories/security-review.repository.js";
import { auditService } from "../../src/services/audit.service.js";
import { authActor, makeCompletedEngineeringTask } from "../helpers.js";

describe("securityReviewAgentService.run", () => {
  it("passes the real, clean store implementation with zero findings", async () => {
    const { agents, storeTask } = await makeCompletedEngineeringTask();

    const outcome = await securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    expect(outcome.result.securityReview.verdict).toBe("PASS");
    expect(JSON.parse(outcome.result.securityReview.findings)).toEqual([]);

    const stored = await securityReviewRepository.findLatestForTask(storeTask.id);
    expect(stored?.id).toBe(outcome.result.securityReview.id);

    const entries = await auditService.list({ resourceType: "ENGINEERING_TASK", resourceId: storeTask.id });
    expect(entries.some((e) => e.action === "CREATE_SECURITY_REVIEW")).toBe(true);
  });

  it("refuses to run against a task that has not completed implementation yet", async () => {
    const { agents, apiTask } = await makeCompletedEngineeringTask();
    await expect(securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: apiTask.id, startedBy: authActor() })).rejects.toThrow(/only runs against a COMPLETED/);
  });
});

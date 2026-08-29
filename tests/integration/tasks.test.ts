import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/shared/errors.js";
import { taskService } from "../../src/services/task.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

describe("taskService", () => {
  it("walks PENDING -> QUEUED -> RUNNING -> COMPLETED", async () => {
    const agent = await makeAgent();
    const task = await taskService.createTask({
      title: "Research competitor pricing",
      objective: "Collect pricing pages for 5 competitors",
      assignedAgentId: agent.id,
      riskLevel: "GREEN",
      actor: HUMAN_OWNER,
    });
    expect(task.status).toBe("PENDING");

    await taskService.transition({ id: task.id, toStatus: "QUEUED", actor: { actorType: "SYSTEM", actorId: "scheduler" } });
    const running = await taskService.transition({
      id: task.id,
      toStatus: "RUNNING",
      actor: { actorType: "AGENT", actorId: agent.id },
    });
    expect(running.startedAt).not.toBeNull();

    const completed = await taskService.transition({
      id: task.id,
      toStatus: "COMPLETED",
      actor: { actorType: "AGENT", actorId: agent.id },
      output: { pagesFound: 5 },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
    expect(JSON.parse(completed.output ?? "null")).toEqual({ pagesFound: 5 });
  });

  it("RUNNING -> FAILED records the error", async () => {
    const agent = await makeAgent();
    const task = await taskService.createTask({
      title: "Flaky scrape",
      objective: "x",
      assignedAgentId: agent.id,
      riskLevel: "GREEN",
      actor: HUMAN_OWNER,
    });
    await taskService.transition({ id: task.id, toStatus: "QUEUED", actor: { actorType: "SYSTEM", actorId: "scheduler" } });
    await taskService.transition({ id: task.id, toStatus: "RUNNING", actor: { actorType: "AGENT", actorId: agent.id } });

    const failed = await taskService.transition({
      id: task.id,
      toStatus: "FAILED",
      actor: { actorType: "AGENT", actorId: agent.id },
      error: "timeout",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toBe("timeout");
  });

  it("rejects an invalid transition (PENDING -> RUNNING)", async () => {
    const agent = await makeAgent();
    const task = await taskService.createTask({
      title: "x",
      objective: "x",
      assignedAgentId: agent.id,
      riskLevel: "GREEN",
      actor: HUMAN_OWNER,
    });

    await expect(
      taskService.transition({ id: task.id, toStatus: "RUNNING", actor: { actorType: "AGENT", actorId: agent.id } }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejects transitioning out of a terminal state", async () => {
    const agent = await makeAgent();
    const task = await taskService.createTask({
      title: "x",
      objective: "x",
      assignedAgentId: agent.id,
      riskLevel: "GREEN",
      actor: HUMAN_OWNER,
    });
    await taskService.transition({ id: task.id, toStatus: "CANCELLED", actor: HUMAN_OWNER });

    await expect(
      taskService.transition({ id: task.id, toStatus: "QUEUED", actor: HUMAN_OWNER }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});

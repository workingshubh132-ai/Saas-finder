import { describe, expect, it } from "vitest";
import { auditService } from "../../src/services/audit.service.js";
import { engineeringTaskService } from "../../src/services/engineering-task.service.js";
import { MAX_TASK_ATTEMPTS } from "../../src/domain/engineering-task/engineering-task.types.js";
import { HUMAN_OWNER, makeMvpArchitecture } from "../helpers.js";

describe("engineeringTaskService.decomposeFromArchitecture", () => {
  it("produces two tasks touching different files, the second depending on the first", async () => {
    const { agents, mvpArchitecture } = await makeMvpArchitecture();

    const tasks = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);

    expect(tasks).toHaveLength(2);
    const [storeTask, apiTask] = tasks;
    expect(storeTask!.status).toBe("PENDING");
    expect(JSON.parse(storeTask!.dependsOnTaskIds)).toEqual([]);
    expect(JSON.parse(apiTask!.dependsOnTaskIds)).toEqual([storeTask!.id]);

    const storeFiles: string[] = JSON.parse(storeTask!.allowedFiles);
    const apiFiles: string[] = JSON.parse(apiTask!.allowedFiles);
    expect(storeFiles.some((f) => apiFiles.includes(f))).toBe(false);

    const entry = (await auditService.list({ resourceType: "PRODUCT", resourceId: mvpArchitecture.productId })).find((e) => e.action === "DECOMPOSE_ENGINEERING_TASKS");
    expect(entry).toBeDefined();
    expect(JSON.parse(entry?.metadata ?? "{}").taskIds).toEqual([storeTask!.id, apiTask!.id]);
  });

  it("refuses to decompose the same architecture twice", async () => {
    const { agents, mvpArchitecture } = await makeMvpArchitecture();
    await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);

    await expect(engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id)).rejects.toThrow(/already has/i);
  });
});

describe("engineeringTaskService.setStatus", () => {
  it("walks PENDING -> IN_PROGRESS -> COMPLETED and audits each transition", async () => {
    const { agents, mvpArchitecture } = await makeMvpArchitecture();
    const [storeTask] = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);

    const inProgress = await engineeringTaskService.setStatus(storeTask!.id, "IN_PROGRESS", { actorType: "AGENT", actorId: agents.engineeringAgent.id });
    expect(inProgress.status).toBe("IN_PROGRESS");
    const completed = await engineeringTaskService.setStatus(storeTask!.id, "COMPLETED", { actorType: "AGENT", actorId: agents.engineeringAgent.id });
    expect(completed.status).toBe("COMPLETED");

    const entries = await auditService.list({ resourceType: "ENGINEERING_TASK", resourceId: storeTask!.id });
    expect(entries.some((e) => e.action === "ENGINEERING_TASK_STATUS_PENDING_TO_IN_PROGRESS")).toBe(true);
    expect(entries.some((e) => e.action === "ENGINEERING_TASK_STATUS_IN_PROGRESS_TO_COMPLETED")).toBe(true);
  });

  it("rejects an illegal transition straight from PENDING to COMPLETED", async () => {
    const { agents, mvpArchitecture } = await makeMvpArchitecture();
    const [storeTask] = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);

    await expect(engineeringTaskService.setStatus(storeTask!.id, "COMPLETED", HUMAN_OWNER)).rejects.toThrow();
  });
});

describe("engineeringTaskService.recordAttempt", () => {
  it("caps retries at MAX_TASK_ATTEMPTS, never allowing an unbounded loop", async () => {
    const { agents, mvpArchitecture } = await makeMvpArchitecture();
    const [storeTask] = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);

    let last = await engineeringTaskService.recordAttempt(storeTask!.id);
    expect(last.task.attemptCount).toBe(1);
    expect(last.retriesRemaining).toBe(MAX_TASK_ATTEMPTS > 1);

    for (let i = 1; i < MAX_TASK_ATTEMPTS; i++) {
      last = await engineeringTaskService.recordAttempt(storeTask!.id);
    }
    expect(last.task.attemptCount).toBe(MAX_TASK_ATTEMPTS);
    expect(last.retriesRemaining).toBe(false);
  });
});

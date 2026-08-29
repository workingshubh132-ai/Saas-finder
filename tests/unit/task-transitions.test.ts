import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { TASK_STATUS_TRANSITIONS } from "../../src/domain/task/task.types.js";

describe("Task status transitions", () => {
  it("PENDING -> QUEUED -> RUNNING -> COMPLETED is a valid path", () => {
    expect(canTransition(TASK_STATUS_TRANSITIONS, "PENDING", "QUEUED")).toBe(true);
    expect(canTransition(TASK_STATUS_TRANSITIONS, "QUEUED", "RUNNING")).toBe(true);
    expect(canTransition(TASK_STATUS_TRANSITIONS, "RUNNING", "COMPLETED")).toBe(true);
  });

  it("RUNNING -> FAILED and RUNNING -> CANCELLED are valid", () => {
    expect(canTransition(TASK_STATUS_TRANSITIONS, "RUNNING", "FAILED")).toBe(true);
    expect(canTransition(TASK_STATUS_TRANSITIONS, "RUNNING", "CANCELLED")).toBe(true);
  });

  it("PENDING -> CANCELLED is valid", () => {
    expect(canTransition(TASK_STATUS_TRANSITIONS, "PENDING", "CANCELLED")).toBe(true);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(TASK_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(TASK_STATUS_TRANSITIONS.FAILED).toEqual([]);
    expect(TASK_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("rejects an invalid jump such as PENDING -> RUNNING", () => {
    expect(canTransition(TASK_STATUS_TRANSITIONS, "PENDING", "RUNNING")).toBe(false);
  });

  it("rejects resurrecting a completed task", () => {
    expect(canTransition(TASK_STATUS_TRANSITIONS, "COMPLETED", "RUNNING")).toBe(false);
  });
});

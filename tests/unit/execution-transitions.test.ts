import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { EXECUTION_STATUS_TRANSITIONS } from "../../src/domain/execution/execution.types.js";

describe("AgentExecution status transitions", () => {
  it("follows the brief's literal example path", () => {
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "CREATED", "QUEUED")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "QUEUED", "RUNNING")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "RUNNING", "WAITING_FOR_TOOL")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "WAITING_FOR_TOOL", "PROCESSING_RESULT")).toBe(false);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "WAITING_FOR_TOOL", "RUNNING")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "RUNNING", "PROCESSING_RESULT")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "PROCESSING_RESULT", "COMPLETED")).toBe(true);
  });

  it("RUNNING -> FAILED and RUNNING -> CANCELLED are valid", () => {
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "RUNNING", "FAILED")).toBe(true);
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "RUNNING", "CANCELLED")).toBe(true);
  });

  it("WAITING_FOR_TOOL -> FAILED is valid", () => {
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "WAITING_FOR_TOOL", "FAILED")).toBe(true);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(EXECUTION_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(EXECUTION_STATUS_TRANSITIONS.FAILED).toEqual([]);
    expect(EXECUTION_STATUS_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("rejects resurrecting a completed execution", () => {
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "COMPLETED", "RUNNING")).toBe(false);
  });

  it("rejects skipping straight from CREATED to RUNNING", () => {
    expect(canTransition(EXECUTION_STATUS_TRANSITIONS, "CREATED", "RUNNING")).toBe(false);
  });
});

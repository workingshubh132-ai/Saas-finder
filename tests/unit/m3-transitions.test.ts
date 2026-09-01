import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/shared/errors.js";
import { assertTransition, canTransition } from "../../src/domain/shared/state-machine.js";
import { SIGNAL_STATUS_TRANSITIONS } from "../../src/domain/signal/signal.types.js";
import { CLUSTER_STATUS_TRANSITIONS } from "../../src/domain/signal/cluster.types.js";
import { PROBLEM_STATUS_TRANSITIONS } from "../../src/domain/problem/problem.types.js";
import { EVIDENCE_GAP_STATUS_TRANSITIONS } from "../../src/domain/evidence-gap/evidence-gap.types.js";
import { RESEARCH_CYCLE_STATUS_TRANSITIONS } from "../../src/domain/research-cycle/research-cycle.types.js";
import { RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS } from "../../src/domain/research-queue/research-queue.types.js";

describe("M3 state machines", () => {
  it("Signal: NEW -> PROCESSED -> CLUSTERED is valid; DUPLICATE/REJECTED/ARCHIVED are terminal", () => {
    expect(canTransition(SIGNAL_STATUS_TRANSITIONS, "NEW", "PROCESSED")).toBe(true);
    expect(canTransition(SIGNAL_STATUS_TRANSITIONS, "PROCESSED", "CLUSTERED")).toBe(true);
    expect(SIGNAL_STATUS_TRANSITIONS.DUPLICATE).toEqual(["ARCHIVED"]);
    expect(SIGNAL_STATUS_TRANSITIONS.REJECTED).toEqual(["ARCHIVED"]);
    expect(SIGNAL_STATUS_TRANSITIONS.ARCHIVED).toEqual([]);
    expect(() => assertTransition("Signal", SIGNAL_STATUS_TRANSITIONS, "CLUSTERED", "PROCESSED")).toThrow(InvalidTransitionError);
  });

  it("SignalCluster: ACTIVE -> ARCHIVED is valid and terminal", () => {
    expect(canTransition(CLUSTER_STATUS_TRANSITIONS, "ACTIVE", "ARCHIVED")).toBe(true);
    expect(CLUSTER_STATUS_TRANSITIONS.ARCHIVED).toEqual([]);
  });

  it("Problem: CANDIDATE can reach PROMOTED, INSUFFICIENT_EVIDENCE, or REJECTED; INSUFFICIENT_EVIDENCE can return to CANDIDATE", () => {
    expect(canTransition(PROBLEM_STATUS_TRANSITIONS, "CANDIDATE", "PROMOTED")).toBe(true);
    expect(canTransition(PROBLEM_STATUS_TRANSITIONS, "CANDIDATE", "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(canTransition(PROBLEM_STATUS_TRANSITIONS, "INSUFFICIENT_EVIDENCE", "CANDIDATE")).toBe(true);
    expect(PROBLEM_STATUS_TRANSITIONS.PROMOTED).toEqual(["ARCHIVED"]);
    expect(() => assertTransition("Problem", PROBLEM_STATUS_TRANSITIONS, "REJECTED", "PROMOTED")).toThrow(InvalidTransitionError);
  });

  it("EvidenceGap: UNKNOWN/ASSUMPTION resolve toward KNOWN or RESOLVED; RESOLVED is terminal", () => {
    expect(canTransition(EVIDENCE_GAP_STATUS_TRANSITIONS, "UNKNOWN", "ASSUMPTION")).toBe(true);
    expect(canTransition(EVIDENCE_GAP_STATUS_TRANSITIONS, "ASSUMPTION", "RESOLVED")).toBe(true);
    expect(EVIDENCE_GAP_STATUS_TRANSITIONS.RESOLVED).toEqual([]);
    expect(() => assertTransition("EvidenceGap", EVIDENCE_GAP_STATUS_TRANSITIONS, "RESOLVED", "UNKNOWN")).toThrow(InvalidTransitionError);
  });

  it("ResearchCycle: SCHEDULED can reach RUNNING or AWAITING_HUMAN; STOPPED/COMPLETED/FAILED/CANCELLED are terminal", () => {
    expect(canTransition(RESEARCH_CYCLE_STATUS_TRANSITIONS, "SCHEDULED", "RUNNING")).toBe(true);
    expect(canTransition(RESEARCH_CYCLE_STATUS_TRANSITIONS, "SCHEDULED", "AWAITING_HUMAN")).toBe(true);
    expect(canTransition(RESEARCH_CYCLE_STATUS_TRANSITIONS, "RUNNING", "STOPPED")).toBe(true);
    for (const terminal of ["STOPPED", "COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(RESEARCH_CYCLE_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("ResearchQueueItem: PENDING -> IN_PROGRESS -> DONE is valid; DONE/SKIPPED are terminal", () => {
    expect(canTransition(RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS, "PENDING", "IN_PROGRESS")).toBe(true);
    expect(canTransition(RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS, "IN_PROGRESS", "DONE")).toBe(true);
    expect(RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS.DONE).toEqual([]);
    expect(RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS.SKIPPED).toEqual([]);
  });
});

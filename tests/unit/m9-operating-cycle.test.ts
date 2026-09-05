import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/shared/errors.js";
import { assertTransition, canTransition } from "../../src/domain/shared/state-machine.js";
import { CYCLE_STAGES, CYCLE_STAGE_TRANSITIONS, isCycleKind, isCycleStage, resolveResumeStage } from "../../src/domain/operating-cycle/operating-cycle.types.js";

describe("OperatingCycle.stage state machine (docs/M9_ARCHITECTURE_PROPOSAL.md §15)", () => {
  it("the fixed linear order CREATED -> ... -> COMPLETED is entirely valid, one step at a time", () => {
    for (let i = 0; i < CYCLE_STAGES.length - 1; i++) {
      const from = CYCLE_STAGES[i]!;
      const to = CYCLE_STAGES[i + 1]!;
      if (from === "AWAITING_HUMAN") continue; // AWAITING_HUMAN's own outgoing set is branch-specific, covered separately below.
      expect(canTransition(CYCLE_STAGE_TRANSITIONS, from, to)).toBe(true);
    }
  });

  it("every stage except COMPLETED and AWAITING_HUMAN itself may branch to AWAITING_HUMAN — except OBSERVING and LEARNING, which must run to completion once EXECUTE has happened", () => {
    for (const stage of CYCLE_STAGES) {
      if (stage === "COMPLETED" || stage === "AWAITING_HUMAN" || stage === "OBSERVING" || stage === "LEARNING") continue;
      expect(canTransition(CYCLE_STAGE_TRANSITIONS, stage, "AWAITING_HUMAN")).toBe(true);
    }
    expect(canTransition(CYCLE_STAGE_TRANSITIONS, "OBSERVING", "AWAITING_HUMAN")).toBe(false);
    expect(canTransition(CYCLE_STAGE_TRANSITIONS, "LEARNING", "AWAITING_HUMAN")).toBe(false);
  });

  it("AWAITING_HUMAN can return to any real stage that could plausibly have requested it, but never to COMPLETED, itself, or CREATED", () => {
    for (const stage of CYCLE_STAGES) {
      if (stage === "COMPLETED" || stage === "AWAITING_HUMAN" || stage === "CREATED") continue;
      expect(canTransition(CYCLE_STAGE_TRANSITIONS, "AWAITING_HUMAN", stage)).toBe(true);
    }
    expect(canTransition(CYCLE_STAGE_TRANSITIONS, "AWAITING_HUMAN", "COMPLETED")).toBe(false);
    expect(canTransition(CYCLE_STAGE_TRANSITIONS, "AWAITING_HUMAN", "AWAITING_HUMAN")).toBe(false);
    // CREATED is deliberately not a return target: nothing in runNextStage's own dispatcher ever calls
    // routeToAwaitingHuman while a cycle is still CREATED (its handler always just advances), so this is a
    // dormant, never-exercised asymmetry in the transition table rather than a reachable gap.
    expect(canTransition(CYCLE_STAGE_TRANSITIONS, "AWAITING_HUMAN", "CREATED")).toBe(false);
  });

  it("COMPLETED is terminal, and skipping a stage (e.g. RESEARCHING straight to EXECUTING) is illegal", () => {
    expect(CYCLE_STAGE_TRANSITIONS.COMPLETED).toEqual([]);
    expect(() => assertTransition("OperatingCycle.stage", CYCLE_STAGE_TRANSITIONS, "RESEARCHING", "EXECUTING")).toThrow(InvalidTransitionError);
  });

  it("isCycleStage / isCycleKind fail closed on unknown strings", () => {
    expect(isCycleStage("NEGOTIATING")).toBe(false);
    expect(isCycleKind("CRON")).toBe(false);
  });
});

describe("resolveResumeStage — where a cycle re-enters after AWAITING_HUMAN, a PAUSE/STOP, or a retry (§15, §17)", () => {
  it("resumes at CREATED when nothing has completed yet", () => {
    expect(resolveResumeStage([])).toBe("CREATED");
  });

  it("resumes at the stage immediately after the furthest one actually completed — AWAITING_HUMAN occupies a real array slot right after DECIDING, so DECIDING as the furthest completed stage resumes at AWAITING_HUMAN, not EXECUTING", () => {
    expect(resolveResumeStage(["CREATED"])).toBe("PLANNING");
    expect(resolveResumeStage(["CREATED", "PLANNING", "RESEARCHING"])).toBe("ANALYZING");
    expect(resolveResumeStage(["CREATED", "PLANNING", "RESEARCHING", "ANALYZING", "DECIDING"])).toBe("AWAITING_HUMAN");
  });

  it("resumes at COMPLETED once every real stage has completed", () => {
    expect(resolveResumeStage(["CREATED", "PLANNING", "RESEARCHING", "ANALYZING", "DECIDING", "AWAITING_HUMAN", "EXECUTING", "OBSERVING", "LEARNING"])).toBe("COMPLETED");
  });

  it("is order-independent — completedLinearStages reads history in enteredAt order, but resolveResumeStage only cares about the furthest index reached", () => {
    expect(resolveResumeStage(["RESEARCHING", "CREATED", "PLANNING"])).toBe("ANALYZING");
  });

  it("EXECUTING is reachable ONLY when AWAITING_HUMAN itself is the furthest completed stage — this pure function alone cannot distinguish 'redo this stage' from 'a human just decided, move on'", () => {
    // If a caller fed resolveResumeStage every completed stage including AWAITING_HUMAN (rather than the
    // schedulerService.completedLinearStages helper's filtered view), DECIDING's own re-entry would be skipped
    // entirely and EXECUTING reached directly:
    expect(resolveResumeStage(["CREATED", "PLANNING", "RESEARCHING", "ANALYZING", "DECIDING", "AWAITING_HUMAN"])).toBe("EXECUTING");
    // completedLinearStages deliberately excludes AWAITING_HUMAN so that most requesting stages (RESEARCHING
    // here) are correctly RE-ENTERED rather than skipped past:
    expect(resolveResumeStage(["CREATED", "PLANNING"])).toBe("RESEARCHING");
    // For DECIDING specifically, that same filtering means a resume always lands back on DECIDING itself, never
    // on EXECUTING — a real gap this build caught (docs/DECISIONS.md's own M9 entry): runNextStage's DECIDING
    // handler must detect "already decided" itself and ask schedulerService.advanceStage for the EXECUTING
    // branch explicitly (via its targetStage override), since neither this function nor advanceStage's own
    // array-adjacency default can ever produce EXECUTING from a filtered, DECIDING-furthest input. Covered
    // end-to-end in tests/integration/m9-capstone-operating-cycle.test.ts.
    expect(resolveResumeStage(["CREATED", "PLANNING", "RESEARCHING", "ANALYZING", "DECIDING"])).toBe("AWAITING_HUMAN");
  });
});

import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { PROSPECT_STATUS_TRANSITIONS, PROSPECT_STATUSES } from "../../src/domain/prospect/prospect.types.js";

describe("Prospect status transitions", () => {
  it("follows the discovery -> qualification -> contact -> completion path", () => {
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "DISCOVERED", "QUALIFIED")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "QUALIFIED", "APPROVED_FOR_DRAFT")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "APPROVED_FOR_DRAFT", "DRAFT_READY")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "DRAFT_READY", "AWAITING_HUMAN_APPROVAL")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "AWAITING_HUMAN_APPROVAL", "APPROVED_TO_CONTACT")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "APPROVED_TO_CONTACT", "CONTACTED")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "CONTACTED", "RESPONDED")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "CONTACTED", "NO_RESPONSE")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "RESPONDED", "COMPLETED")).toBe(true);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "NO_RESPONSE", "COMPLETED")).toBe(true);
  });

  it("DO_NOT_CONTACT is reachable from every non-terminal state — a human or policy check can pull a prospect out of the pipeline at any point (docs/M5_ARCHITECTURE_PROPOSAL.md §8)", () => {
    const nonTerminal = PROSPECT_STATUSES.filter((s) => s !== "REJECTED" && s !== "DO_NOT_CONTACT" && s !== "COMPLETED");
    expect(nonTerminal.length).toBeGreaterThan(0);
    for (const status of nonTerminal) {
      expect(canTransition(PROSPECT_STATUS_TRANSITIONS, status, "DO_NOT_CONTACT")).toBe(true);
    }
  });

  it("REJECTED, DO_NOT_CONTACT, and COMPLETED are terminal", () => {
    expect(PROSPECT_STATUS_TRANSITIONS.REJECTED).toEqual([]);
    expect(PROSPECT_STATUS_TRANSITIONS.DO_NOT_CONTACT).toEqual([]);
    expect(PROSPECT_STATUS_TRANSITIONS.COMPLETED).toEqual([]);
  });

  it("rejects skipping straight from DISCOVERED to APPROVED_TO_CONTACT", () => {
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "DISCOVERED", "APPROVED_TO_CONTACT")).toBe(false);
  });

  it("rejects moving out of a terminal state", () => {
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "DO_NOT_CONTACT", "DISCOVERED")).toBe(false);
    expect(canTransition(PROSPECT_STATUS_TRANSITIONS, "COMPLETED", "CONTACTED")).toBe(false);
  });
});

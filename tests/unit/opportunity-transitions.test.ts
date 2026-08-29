import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { OPPORTUNITY_STATUS_TRANSITIONS } from "../../src/domain/opportunity/opportunity.types.js";

describe("Opportunity status transitions", () => {
  it("follows the discovery -> validation -> approval path", () => {
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "DISCOVERED", "RESEARCHING")).toBe(true);
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "RESEARCHING", "VALIDATING")).toBe(true);
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "VALIDATING", "VALIDATED")).toBe(true);
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "VALIDATED", "APPROVED")).toBe(true);
  });

  it("ARCHIVED is reachable from every non-terminal state", () => {
    for (const status of ["DISCOVERED", "RESEARCHING", "VALIDATING", "VALIDATED", "APPROVED", "REJECTED"] as const) {
      expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, status, "ARCHIVED")).toBe(true);
    }
  });

  it("ARCHIVED is terminal", () => {
    expect(OPPORTUNITY_STATUS_TRANSITIONS.ARCHIVED).toEqual([]);
  });

  it("rejects skipping straight from DISCOVERED to APPROVED", () => {
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "DISCOVERED", "APPROVED")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CLAIM_VALIDATION_STATUSES, CLAIM_VALIDATION_TRANSITIONS } from "../../src/domain/claim/claim-validation.types.js";
import { assertTransition, canTransition } from "../../src/domain/shared/state-machine.js";
import { OPPORTUNITY_STATUS_TRANSITIONS } from "../../src/domain/opportunity/opportunity.types.js";

describe("CLAIM_VALIDATION_TRANSITIONS", () => {
  it("is the complete digraph — every status reaches every status, including itself", () => {
    for (const from of CLAIM_VALIDATION_STATUSES) {
      for (const to of CLAIM_VALIDATION_STATUSES) {
        expect(canTransition(CLAIM_VALIDATION_TRANSITIONS, from, to)).toBe(true);
      }
    }
  });

  it("never throws for any real transition, including a re-confirming self-loop", () => {
    for (const from of CLAIM_VALIDATION_STATUSES) {
      expect(() => assertTransition("Claim", CLAIM_VALIDATION_TRANSITIONS, from, from)).not.toThrow();
    }
    expect(() => assertTransition("Claim", CLAIM_VALIDATION_TRANSITIONS, "SUPPORTED", "CONTRADICTED")).not.toThrow();
    expect(() => assertTransition("Claim", CLAIM_VALIDATION_TRANSITIONS, "CONTRADICTED", "CONFLICTED")).not.toThrow();
  });
});

describe("OPPORTUNITY_STATUS_TRANSITIONS — KILLED (M4)", () => {
  it("KILLED is reachable from every non-terminal status", () => {
    for (const from of ["DISCOVERED", "RESEARCHING", "VALIDATING", "VALIDATED", "APPROVED"] as const) {
      expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, from, "KILLED")).toBe(true);
    }
  });

  it("KILLED only ever moves to ARCHIVED — never un-killed by transition", () => {
    expect(OPPORTUNITY_STATUS_TRANSITIONS.KILLED).toEqual(["ARCHIVED"]);
  });

  it("REJECTED cannot transition to KILLED — REJECTED is already terminal-ish (only reaches ARCHIVED)", () => {
    expect(canTransition(OPPORTUNITY_STATUS_TRANSITIONS, "REJECTED", "KILLED")).toBe(false);
  });
});

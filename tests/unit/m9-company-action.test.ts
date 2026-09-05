import { describe, expect, it } from "vitest";
import { CHAIRMAN_DECISIONS } from "../../src/domain/chairman/chairman.types.js";
import { COMPANY_ACTIONS, isCompanyAction, resolveCeoChairmanConflict } from "../../src/domain/company-action/company-action.types.js";
import { isConflictingAction } from "../../src/domain/concurrency/concurrency.types.js";

describe("resolveCeoChairmanConflict — the one terminal, human-review-only conflict state (docs/M9_ARCHITECTURE_PROPOSAL.md §34)", () => {
  it("is exhaustive: every (CompanyAction, ChairmanDecision) pair resolves to PROCEED or CONFLICTED, never throws or silently defaults", () => {
    for (const action of COMPANY_ACTIONS) {
      for (const decision of CHAIRMAN_DECISIONS) {
        expect(["PROCEED", "CONFLICTED"]).toContain(resolveCeoChairmanConflict(action, decision));
      }
    }
  });

  it("APPROVE always proceeds, regardless of the CEO's own action", () => {
    for (const action of COMPANY_ACTIONS) {
      expect(resolveCeoChairmanConflict(action, "APPROVE")).toBe("PROCEED");
    }
  });

  it("REQUEST_CHANGES and ESCALATE_TO_HUMAN always conflict, regardless of the CEO's own action", () => {
    for (const action of COMPANY_ACTIONS) {
      expect(resolveCeoChairmanConflict(action, "REQUEST_CHANGES")).toBe("CONFLICTED");
      expect(resolveCeoChairmanConflict(action, "ESCALATE_TO_HUMAN")).toBe("CONFLICTED");
    }
  });

  it("the brief's own named example — CEO=INVEST, Chairman=REJECT — is a real conflict", () => {
    expect(resolveCeoChairmanConflict("INVEST", "REJECT")).toBe("CONFLICTED");
  });

  it("REJECT on an already-cautious action is not a genuine conflict — the Chairman is asking for caution the CEO's own action already reflects", () => {
    expect(resolveCeoChairmanConflict("PAUSE", "REJECT")).toBe("PROCEED");
    expect(resolveCeoChairmanConflict("REDUCE_COST", "REJECT")).toBe("PROCEED");
    expect(resolveCeoChairmanConflict("PREPARE_KILL_REVIEW", "REJECT")).toBe("PROCEED");
    expect(resolveCeoChairmanConflict("MAINTAIN", "REJECT")).toBe("PROCEED");
  });

  it("REQUEST_MORE_EVIDENCE conflicts only against the three already-cautious actions, never against an expansive one like GROW/INVEST", () => {
    expect(resolveCeoChairmanConflict("PREPARE_KILL_REVIEW", "REQUEST_MORE_EVIDENCE")).toBe("CONFLICTED");
    expect(resolveCeoChairmanConflict("PAUSE", "REQUEST_MORE_EVIDENCE")).toBe("CONFLICTED");
    expect(resolveCeoChairmanConflict("REDUCE_COST", "REQUEST_MORE_EVIDENCE")).toBe("CONFLICTED");
    expect(resolveCeoChairmanConflict("GROW", "REQUEST_MORE_EVIDENCE")).toBe("PROCEED");
    expect(resolveCeoChairmanConflict("INVEST", "REQUEST_MORE_EVIDENCE")).toBe("PROCEED");
  });

  it("isCompanyAction fails closed on an unknown string", () => {
    expect(isCompanyAction("CONQUER_MARKET")).toBe(false);
  });
});

describe("isConflictingAction — Concurrency conflict detection's own directional check (§40)", () => {
  it("an expansive action and a contractive action conflict", () => {
    expect(isConflictingAction("INVEST", "PAUSE")).toBe(true);
    expect(isConflictingAction("GROW", "REDUCE_COST")).toBe(true);
    expect(isConflictingAction("PREPARE_KILL_REVIEW", "BUILD")).toBe(true);
  });

  it("two actions in the same camp never conflict, even if they differ", () => {
    expect(isConflictingAction("INVEST", "GROW")).toBe(false);
    expect(isConflictingAction("PAUSE", "REDUCE_COST")).toBe(false);
  });

  it("an action never conflicts with itself", () => {
    expect(isConflictingAction("INVEST", "INVEST")).toBe(false);
  });

  it("a neutral action (MAINTAIN) never conflicts with anything", () => {
    expect(isConflictingAction("MAINTAIN", "INVEST")).toBe(false);
    expect(isConflictingAction("MAINTAIN", "PAUSE")).toBe(false);
  });
});

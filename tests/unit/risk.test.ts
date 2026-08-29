import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, type TransitionTable } from "../../src/domain/shared/state-machine.js";
import { InvalidTransitionError } from "../../src/domain/shared/errors.js";
import { getPermissionRiskLevel } from "../../src/domain/risk/permission-risk-policy.js";
import { getRiskPolicy, isRiskLevel, RISK_LEVELS } from "../../src/domain/risk/risk-level.js";
import { isPermission, PERMISSIONS } from "../../src/domain/permission/permission.js";

describe("risk policy", () => {
  it("classifies every permission into exactly one of the four risk levels", () => {
    for (const permission of PERMISSIONS) {
      expect(RISK_LEVELS).toContain(getPermissionRiskLevel(permission));
    }
  });

  it("GREEN does not require approval", () => {
    expect(getRiskPolicy("GREEN").requiresApproval).toBe(false);
  });

  it("YELLOW requires approval but is auto-executable once approved", () => {
    const policy = getRiskPolicy("YELLOW");
    expect(policy.requiresApproval).toBe(true);
    expect(policy.autoExecutableAfterApproval).toBe(true);
  });

  it("ORANGE requires approval and flags Chairman-level governance", () => {
    const policy = getRiskPolicy("ORANGE");
    expect(policy.requiresApproval).toBe(true);
    expect(policy.requiresChairman).toBe(true);
  });

  it("RED requires approval and is never auto-executable, even once approved", () => {
    const policy = getRiskPolicy("RED");
    expect(policy.requiresApproval).toBe(true);
    expect(policy.autoExecutableAfterApproval).toBe(false);
  });

  it("isRiskLevel / isPermission fail closed on unknown strings", () => {
    expect(isRiskLevel("PURPLE")).toBe(false);
    expect(isPermission("DO_ANYTHING")).toBe(false);
  });
});

describe("generic state machine", () => {
  type S = "A" | "B" | "C";
  const table: TransitionTable<S> = { A: ["B"], B: ["C"], C: [] };

  it("allows a listed transition", () => {
    expect(canTransition(table, "A", "B")).toBe(true);
  });

  it("rejects an unlisted transition", () => {
    expect(canTransition(table, "A", "C")).toBe(false);
  });

  it("assertTransition throws InvalidTransitionError for an illegal move", () => {
    expect(() => assertTransition("Widget", table, "C", "A")).toThrow(InvalidTransitionError);
  });

  it("assertTransition is silent for a legal move", () => {
    expect(() => assertTransition("Widget", table, "A", "B")).not.toThrow();
  });
});

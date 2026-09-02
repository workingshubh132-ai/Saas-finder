import { describe, expect, it } from "vitest";
import { CONTACT_POLICIES, DEFAULT_CONTACT_POLICY, isWithinPolicyCeiling } from "../../src/domain/prospect/contact-policy.js";

describe("isWithinPolicyCeiling", () => {
  it("a policy is always within its own ceiling", () => {
    for (const policy of CONTACT_POLICIES) {
      expect(isWithinPolicyCeiling(policy, policy)).toBe(true);
    }
  });

  it("DO_NOT_CONTACT is the floor — within every ceiling", () => {
    for (const ceiling of CONTACT_POLICIES) {
      expect(isWithinPolicyCeiling("DO_NOT_CONTACT", ceiling)).toBe(true);
    }
  });

  it("APPROVED is the ceiling — only within itself", () => {
    expect(isWithinPolicyCeiling("APPROVED", "APPROVED")).toBe(true);
    expect(isWithinPolicyCeiling("APPROVED", "HUMAN_APPROVAL_REQUIRED")).toBe(false);
    expect(isWithinPolicyCeiling("APPROVED", "NO_CONTACT")).toBe(false);
  });

  it("rejects a prospect-level policy more permissive than the experiment's own ceiling", () => {
    expect(isWithinPolicyCeiling("APPROVED", "RESEARCH_ONLY")).toBe(false);
    expect(isWithinPolicyCeiling("HUMAN_APPROVAL_REQUIRED", "NO_CONTACT")).toBe(false);
  });

  it("accepts a prospect-level policy at least as strict as the experiment's own ceiling", () => {
    expect(isWithinPolicyCeiling("NO_CONTACT", "APPROVED")).toBe(true);
    expect(isWithinPolicyCeiling("RESEARCH_ONLY", "HUMAN_APPROVAL_REQUIRED")).toBe(true);
  });

  it("DEFAULT_CONTACT_POLICY is HUMAN_APPROVAL_REQUIRED — never APPROVED by default (docs/M5_ARCHITECTURE_PROPOSAL.md §9)", () => {
    expect(DEFAULT_CONTACT_POLICY).toBe("HUMAN_APPROVAL_REQUIRED");
  });
});

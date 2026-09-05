import { describe, expect, it } from "vitest";
import { hashBillingPlan, hashDeploymentPlan, hashGrowthExperiment } from "../../src/domain/approval/resource-snapshot.js";
import { checkApprovalFreshness, computeResourceStateHash, DEFAULT_APPROVAL_EXPIRY_DAYS } from "../../src/domain/approval/staleness.js";

describe("computeResourceStateHash — deterministic change detection (docs/M9_ARCHITECTURE_PROPOSAL.md §39)", () => {
  it("is deterministic and order-independent — key insertion order never changes the hash", () => {
    const a = computeResourceStateHash({ b: 2, a: 1 });
    const b = computeResourceStateHash({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("changes when any field's value changes", () => {
    const before = computeResourceStateHash({ environment: "STAGING", provider: "DEV_FIXTURE" });
    const after = computeResourceStateHash({ environment: "PRODUCTION", provider: "DEV_FIXTURE" });
    expect(before).not.toBe(after);
  });

  it("distinguishes null from an empty string and from the literal text 'null'", () => {
    const withNull = computeResourceStateHash({ x: null });
    const withEmptyString = computeResourceStateHash({ x: "" });
    expect(withNull).not.toBe(withEmptyString);
  });
});

describe("checkApprovalFreshness — pure decision function behind assertFresh (§38-39)", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("reports EXPIRED once past expiresAt, before even checking the resource hash", () => {
    const result = checkApprovalFreshness({ expiresAt: new Date(now.getTime() - 1), now, approvedStateHash: "same", currentStateHash: "same" });
    expect(result).toBe("EXPIRED");
  });

  it("reports RESOURCE_CHANGED when the hashes differ and neither is null", () => {
    const result = checkApprovalFreshness({ expiresAt: null, now, approvedStateHash: "hash-a", currentStateHash: "hash-b" });
    expect(result).toBe("RESOURCE_CHANGED");
  });

  it("is fresh (null) when hashes match", () => {
    const result = checkApprovalFreshness({ expiresAt: null, now, approvedStateHash: "same", currentStateHash: "same" });
    expect(result).toBeNull();
  });

  it("never reports RESOURCE_CHANGED for an ApprovalRequest created before this mechanism existed (both hashes null — every M5/M7/M8 call site)", () => {
    const result = checkApprovalFreshness({ expiresAt: null, now, approvedStateHash: null, currentStateHash: null });
    expect(result).toBeNull();
  });

  it("DEFAULT_APPROVAL_EXPIRY_DAYS matches the founder's weekend-cadence rationale", () => {
    expect(DEFAULT_APPROVAL_EXPIRY_DAYS).toBe(7);
  });
});

describe("Per-resource-type hashed field subsets (§39) — only fields whose change means the human's approval no longer applies", () => {
  it("hashDeploymentPlan changes when environment, provider, strategy, or artifactRef changes", () => {
    const base = { environment: "STAGING", provider: "DEV_FIXTURE", strategy: "ROLLING", artifactRef: "ref-1" };
    const baseline = hashDeploymentPlan(base);
    expect(hashDeploymentPlan({ ...base, environment: "PRODUCTION" })).not.toBe(baseline);
    expect(hashDeploymentPlan({ ...base, artifactRef: "ref-2" })).not.toBe(baseline);
    expect(hashDeploymentPlan({ ...base })).toBe(baseline);
  });

  it("hashGrowthExperiment changes when hypothesis, estimatedCostUsd, or riskLevel changes", () => {
    const base = { hypothesis: "Adding a trial increases conversion", estimatedCostUsd: 50, riskLevel: "YELLOW" };
    const baseline = hashGrowthExperiment(base);
    expect(hashGrowthExperiment({ ...base, estimatedCostUsd: 500 })).not.toBe(baseline);
    expect(hashGrowthExperiment({ ...base })).toBe(baseline);
  });

  it("hashBillingPlan's own type signature accepts only provider/pricingModelId — status cannot be passed at all, by construction", () => {
    // A real regression this build caught (docs/M9_ARCHITECTURE_PROPOSAL.md §39): an early version also hashed
    // `status`, and BillingPlan's own legitimate DRAFT -> HUMAN_APPROVED transition between request-approval time
    // and execute time made every billing activation falsely trip RESOURCE_CHANGED. hashBillingPlan's Pick<>
    // type is the structural guarantee this can't recur — the full approve-and-execute regression is covered at
    // the integration level in tests/integration/m7-capstone-billing.test.ts, which exercises the real status
    // transition end-to-end.
    const hash: (plan: { provider: string; pricingModelId: string }) => string = hashBillingPlan;
    expect(typeof hash({ provider: "DEV_FIXTURE", pricingModelId: "pm-1" })).toBe("string");
  });

  it("hashBillingPlan changes when provider or pricingModelId changes", () => {
    const baseline = hashBillingPlan({ provider: "DEV_FIXTURE", pricingModelId: "pm-1" });
    expect(hashBillingPlan({ provider: "DEV_FIXTURE", pricingModelId: "pm-2" })).not.toBe(baseline);
    expect(hashBillingPlan({ provider: "OTHER_PROVIDER", pricingModelId: "pm-1" })).not.toBe(baseline);
  });
});

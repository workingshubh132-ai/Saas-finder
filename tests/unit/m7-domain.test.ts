import { describe, expect, it } from "vitest";
import { checkLaunchBudget } from "../../src/domain/product/launch-budget.js";
import { computeUnitEconomics } from "../../src/domain/pricing-model/unit-economics.js";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { DEPLOYMENT_PLAN_STATUS_TRANSITIONS } from "../../src/domain/deployment-plan/deployment-plan.types.js";
import { BILLING_PLAN_STATUS_TRANSITIONS } from "../../src/domain/billing-plan/billing-plan.types.js";
import { INCIDENT_STATUS_TRANSITIONS } from "../../src/domain/incident/incident.types.js";
import { SUPPORT_CASE_STATUS_TRANSITIONS } from "../../src/domain/support-case/support-case.types.js";
import { PRODUCT_STATUS_TRANSITIONS } from "../../src/domain/product/product.types.js";
import { signWebhookPayload, verifyWebhookSignature } from "../../src/domain/webhook/webhook-security.js";

describe("checkLaunchBudget", () => {
  it("flags an estimate over the ceiling as budgetExceeded", () => {
    const result = checkLaunchBudget({ estimatedMonthlyCostUsd: 500 });
    expect(result.budgetExceeded).toBe(true);
    expect(result.reasoning).toContain("exceeds");
  });

  it("does not flag an estimate within the default ceiling", () => {
    const result = checkLaunchBudget({ estimatedMonthlyCostUsd: 50 });
    expect(result.budgetExceeded).toBe(false);
  });

  it("respects an explicit ceiling override", () => {
    expect(checkLaunchBudget({ estimatedMonthlyCostUsd: 50, ceilingUsd: 10 }).budgetExceeded).toBe(true);
  });

  it("treats exactly-at-the-ceiling as within budget, not exceeded", () => {
    expect(checkLaunchBudget({ estimatedMonthlyCostUsd: 200 }).budgetExceeded).toBe(false);
  });
});

describe("computeUnitEconomics", () => {
  it("computes cost-per-customer, gross margin, and gross margin percentage from real inputs", () => {
    const result = computeUnitEconomics({ monthlyPriceUsd: 49, estimatedOperatingCostUsdPerMonth: 100, estimatedCustomerCountForCostBasis: 10 });
    expect(result.costPerCustomerUsd).toBeCloseTo(10);
    expect(result.grossMarginUsd).toBeCloseTo(39);
    expect(result.grossMarginPct).toBeCloseTo(39 / 49);
  });

  it("never divides by zero — a customer count of 0 is floored to 1", () => {
    const result = computeUnitEconomics({ monthlyPriceUsd: 49, estimatedOperatingCostUsdPerMonth: 100, estimatedCustomerCountForCostBasis: 0 });
    expect(Number.isFinite(result.costPerCustomerUsd)).toBe(true);
    expect(result.costPerCustomerUsd).toBeCloseTo(100);
  });

  it("reports a negative gross margin honestly when cost exceeds price, never clamped to zero", () => {
    const result = computeUnitEconomics({ monthlyPriceUsd: 10, estimatedOperatingCostUsdPerMonth: 500, estimatedCustomerCountForCostBasis: 1 });
    expect(result.grossMarginUsd).toBeLessThan(0);
    expect(result.grossMarginPct).toBeLessThan(0);
  });
});

describe("webhook-security", () => {
  const secret = "test-secret-value";
  const rawBody = JSON.stringify({ eventType: "subscription.created" });

  it("verifies a correctly-signed, fresh payload", () => {
    const timestamp = Date.now();
    const signature = signWebhookPayload(secret, rawBody, timestamp);
    const result = verifyWebhookSignature({ secret, rawBody, timestamp, signature, now: timestamp });
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const timestamp = Date.now();
    const result = verifyWebhookSignature({ secret, rawBody, timestamp, signature: "0".repeat(64), now: timestamp });
    expect(result.valid).toBe(false);
  });

  it("rejects a signature computed against a different body (tampered payload)", () => {
    const timestamp = Date.now();
    const signature = signWebhookPayload(secret, rawBody, timestamp);
    const result = verifyWebhookSignature({ secret, rawBody: JSON.stringify({ eventType: "subscription.cancelled" }), timestamp, signature, now: timestamp });
    expect(result.valid).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const timestamp = Date.now();
    const signature = signWebhookPayload("wrong-secret", rawBody, timestamp);
    const result = verifyWebhookSignature({ secret, rawBody, timestamp, signature, now: timestamp });
    expect(result.valid).toBe(false);
  });

  it("rejects a timestamp outside the replay window, even with a correct signature", () => {
    const timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes old
    const signature = signWebhookPayload(secret, rawBody, timestamp);
    const result = verifyWebhookSignature({ secret, rawBody, timestamp, signature, now: Date.now() });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("replay window");
  });

  it("rejects a malformed (non-hex) signature without throwing", () => {
    const timestamp = Date.now();
    expect(() => verifyWebhookSignature({ secret, rawBody, timestamp, signature: "not-hex!!", now: timestamp })).not.toThrow();
    const result = verifyWebhookSignature({ secret, rawBody, timestamp, signature: "not-hex!!", now: timestamp });
    expect(result.valid).toBe(false);
  });
});

describe("M7 status transitions", () => {
  it("DeploymentPlan: DRAFT -> PENDING_APPROVAL -> HUMAN_APPROVED -> EXECUTED is a valid path", () => {
    expect(canTransition(DEPLOYMENT_PLAN_STATUS_TRANSITIONS, "DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition(DEPLOYMENT_PLAN_STATUS_TRANSITIONS, "PENDING_APPROVAL", "HUMAN_APPROVED")).toBe(true);
    expect(canTransition(DEPLOYMENT_PLAN_STATUS_TRANSITIONS, "HUMAN_APPROVED", "EXECUTED")).toBe(true);
  });

  it("DeploymentPlan: EXECUTED and REJECTED are terminal", () => {
    expect(DEPLOYMENT_PLAN_STATUS_TRANSITIONS.EXECUTED).toEqual([]);
    expect(DEPLOYMENT_PLAN_STATUS_TRANSITIONS.REJECTED).toEqual([]);
  });

  it("DeploymentPlan: a failed EXECUTE never advances the plan itself past HUMAN_APPROVED (no HUMAN_APPROVED -> REJECTED/DRAFT path)", () => {
    expect(canTransition(DEPLOYMENT_PLAN_STATUS_TRANSITIONS, "HUMAN_APPROVED", "REJECTED")).toBe(false);
    expect(canTransition(DEPLOYMENT_PLAN_STATUS_TRANSITIONS, "HUMAN_APPROVED", "DRAFT")).toBe(false);
  });

  it("BillingPlan: DRAFT -> HUMAN_APPROVED -> ACTIVE -> SUSPENDED -> ACTIVE -> CANCELLED is a valid path", () => {
    expect(canTransition(BILLING_PLAN_STATUS_TRANSITIONS, "DRAFT", "HUMAN_APPROVED")).toBe(true);
    expect(canTransition(BILLING_PLAN_STATUS_TRANSITIONS, "HUMAN_APPROVED", "ACTIVE")).toBe(true);
    expect(canTransition(BILLING_PLAN_STATUS_TRANSITIONS, "ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransition(BILLING_PLAN_STATUS_TRANSITIONS, "SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransition(BILLING_PLAN_STATUS_TRANSITIONS, "ACTIVE", "CANCELLED")).toBe(true);
  });

  it("BillingPlan: there is no READY state distinct from DRAFT (the minimum correct state machine)", () => {
    expect(Object.keys(BILLING_PLAN_STATUS_TRANSITIONS)).not.toContain("READY");
  });

  it("Incident: DETECTED through POSTMORTEM, with a RESOLVED -> INVESTIGATING recurrence path", () => {
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "DETECTED", "TRIAGED")).toBe(true);
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "TRIAGED", "INVESTIGATING")).toBe(true);
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "INVESTIGATING", "MITIGATING")).toBe(true);
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "MITIGATING", "RESOLVED")).toBe(true);
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "RESOLVED", "POSTMORTEM")).toBe(true);
    expect(canTransition(INCIDENT_STATUS_TRANSITIONS, "RESOLVED", "INVESTIGATING")).toBe(true);
  });

  it("SupportCase: OPEN through RESOLVED, and RESOLVED can reopen to IN_PROGRESS", () => {
    expect(canTransition(SUPPORT_CASE_STATUS_TRANSITIONS, "OPEN", "TRIAGED")).toBe(true);
    expect(canTransition(SUPPORT_CASE_STATUS_TRANSITIONS, "TRIAGED", "IN_PROGRESS")).toBe(true);
    expect(canTransition(SUPPORT_CASE_STATUS_TRANSITIONS, "IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(canTransition(SUPPORT_CASE_STATUS_TRANSITIONS, "RESOLVED", "IN_PROGRESS")).toBe(true);
  });

  it("Product: the full M7 launch path is legal, and LIVE/PAUSED never transition to FAILED", () => {
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "READY_FOR_DEPLOYMENT", "LAUNCH_PLANNING")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "LAUNCH_PLANNING", "AWAITING_LAUNCH_APPROVAL")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "AWAITING_LAUNCH_APPROVAL", "DEPLOYING")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "DEPLOYING", "LIVE")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "LIVE", "PAUSED")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "PAUSED", "LIVE")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "LIVE", "FAILED")).toBe(false);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "PAUSED", "FAILED")).toBe(false);
  });

  it("Product: a failed EXECUTE reverts DEPLOYING to AWAITING_LAUNCH_APPROVAL for a retry, never straight to FAILED", () => {
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "DEPLOYING", "AWAITING_LAUNCH_APPROVAL")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "DEPLOYING", "FAILED")).toBe(false);
  });

  it("Product: LIVE/PAUSED -> ARCHIVED models a human's deliberate kill of a live product", () => {
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "LIVE", "ARCHIVED")).toBe(true);
    expect(canTransition(PRODUCT_STATUS_TRANSITIONS, "PAUSED", "ARCHIVED")).toBe(true);
  });
});

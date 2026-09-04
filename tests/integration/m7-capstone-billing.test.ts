import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { billingAccountRepository } from "../../src/db/repositories/billing-account.repository.js";
import { businessMetricRepository } from "../../src/db/repositories/business-metric.repository.js";
import { signWebhookPayload } from "../../src/domain/webhook/webhook-security.js";
import { approvalService } from "../../src/services/approval.service.js";
import { billingActivationService } from "../../src/services/billing-activation.service.js";
import { billingPlanService } from "../../src/services/billing-plan.service.js";
import { HUMAN_OWNER, makeAwaitingLaunchApprovalProduct } from "../helpers.js";

const app = createApp();

interface WebhookPayload {
  provider: string;
  billingAccountId: string;
  deliveryId: string;
  eventType: string;
  data: { amountUsdCents: number };
}

function signedWebhookRequest(secret: string, payload: WebhookPayload, timestamp = Date.now()) {
  const rawBody = JSON.stringify(payload);
  const signature = signWebhookPayload(secret, rawBody, timestamp);
  return request(app)
    .post("/api/billing-webhooks/dev-fixture")
    .set("Content-Type", "application/json")
    .set("X-Webhook-Signature", signature)
    .set("X-Webhook-Timestamp", String(timestamp))
    .send(rawBody);
}

/**
 * M7 mandatory capstone #3 (M7-specific, required by the brief by
 * name, docs/M7_ARCHITECTURE_PROPOSAL.md §40.4): PricingModel ->
 * BillingPlan -> human approval -> ACTIVATE_BILLING EXECUTE against
 * the DEV_FIXTURE BillingProvider -> a fixture subscription -> a real
 * webhook delivery (real HMAC signature, real replay/idempotency
 * protection, real source validation) -> a real, correctly-labeled
 * BusinessMetric. Every fixture is DEV_FIXTURE-labeled; nothing here
 * is ever presented as, or could be confused with, real revenue.
 */
describe("M7 capstone: billing path", () => {
  it(
    "activates billing, creates a fixture subscription, and processes a signed webhook into a correctly-labeled OBSERVED BusinessMetric — replay and tampered-signature deliveries are both rejected",
    async () => {
      const { agents, product, pricingModel } = await makeAwaitingLaunchApprovalProduct();

      const billingPlan = await billingPlanService.create({ productId: product.id, pricingModelId: pricingModel.id, provider: "DEV_FIXTURE" });
      expect(billingPlan.status).toBe("DRAFT");

      const approvalRequest = await billingPlanService.requestApproval({ billingPlanId: billingPlan.id, requestedByAgentId: agents.pricingAgent.id });
      expect(approvalRequest.riskLevel).toBe("RED");
      expect(approvalRequest.action).toBe("ACTIVATE_BILLING");

      await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
      const approvedPlan = await billingPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
      expect(approvedPlan.status).toBe("HUMAN_APPROVED");

      // ACTIVATE_BILLING EXECUTE — the moment real payment collection becomes possible (fixture-scoped only, §7).
      const billingAccount = await billingActivationService.activate({ billingPlanId: billingPlan.id, actor: HUMAN_OWNER });
      expect(billingAccount.provider).toBe("DEV_FIXTURE");
      expect(billingAccount.status).toBe("ACTIVE");
      expect(billingAccount.providerProductRef).toMatch(/^dev-prod-/);
      expect(billingAccount.webhookSecret.length).toBeGreaterThanOrEqual(32);

      const finalBillingPlan = await billingPlanService.getOrThrow(billingPlan.id);
      expect(finalBillingPlan.status).toBe("ACTIVE");

      // Test/demo-only subscription fixture (§19, §40.4) — never invoked from any agent.
      const subscription = await billingActivationService.recordSubscriptionFixture({ billingAccountId: billingAccount.id, customerEmail: "dev-fixture-customer@example.test" });
      expect(subscription.providerSubscriptionRef).toMatch(/^dev-sub-/);

      // A real, signed webhook delivery over HTTP — the one genuinely public-shaped endpoint (§20, §34).
      const payload: WebhookPayload = { provider: "DEV_FIXTURE", billingAccountId: billingAccount.id, deliveryId: "evt_test_1", eventType: "subscription.created", data: { amountUsdCents: 4900 } };
      const delivered = await signedWebhookRequest(billingAccount.webhookSecret, payload);
      expect(delivered.status).toBe(200);
      expect(delivered.body).toEqual({ received: true });

      const metrics = await businessMetricRepository.listForProduct(product.id);
      const revenueMetric = metrics.find((m) => m.metricType === "REVENUE_USD");
      expect(revenueMetric).toBeDefined();
      expect(revenueMetric?.valueKind).toBe("OBSERVED");
      expect(revenueMetric?.source).toBe("DEV_FIXTURE");
      expect(revenueMetric?.value).toBeCloseTo(49.0);

      // Replay protection (§20) — the exact same delivery id is rejected outright, never reprocessed into a second metric.
      const replay = await signedWebhookRequest(billingAccount.webhookSecret, payload);
      expect(replay.status).toBe(409);
      const metricsAfterReplay = await businessMetricRepository.listForProduct(product.id);
      expect(metricsAfterReplay.filter((m) => m.metricType === "REVENUE_USD").length).toBe(1);

      // Signature verification (§20) — a tampered signature is rejected, and the tampered delivery id (never seen before) is still recorded as an invalid attempt, not silently dropped.
      const tampered = await request(app)
        .post("/api/billing-webhooks/dev-fixture")
        .set("Content-Type", "application/json")
        .set("X-Webhook-Signature", "0".repeat(64))
        .set("X-Webhook-Timestamp", String(Date.now()))
        .send(JSON.stringify({ ...payload, deliveryId: "evt_test_2" }));
      expect(tampered.status).toBe(401);
      const metricsAfterTampered = await businessMetricRepository.listForProduct(product.id);
      expect(metricsAfterTampered.filter((m) => m.metricType === "REVENUE_USD").length).toBe(1);

      // Source validation (§20) — an unknown billing account is rejected before a signature is even checked.
      const unknownAccount = await request(app)
        .post("/api/billing-webhooks/dev-fixture")
        .set("Content-Type", "application/json")
        .set("X-Webhook-Signature", "1".repeat(64))
        .set("X-Webhook-Timestamp", String(Date.now()))
        .send(JSON.stringify({ ...payload, billingAccountId: "does-not-exist", deliveryId: "evt_test_3" }));
      expect(unknownAccount.status).toBe(404);

      // The BillingAccount that actually exists on disk is the real fixture-scoped one — never confused with a real customer/subscription.
      const storedAccount = await billingAccountRepository.findById(billingAccount.id);
      expect(storedAccount?.provider).toBe("DEV_FIXTURE");
    },
    { timeout: 180_000 },
  );
});

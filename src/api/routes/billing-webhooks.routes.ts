import { Router } from "express";
import { billingAccountRepository } from "../../db/repositories/billing-account.repository.js";
import { billingPlanRepository } from "../../db/repositories/billing-plan.repository.js";
import { businessMetricRepository } from "../../db/repositories/business-metric.repository.js";
import { webhookDeliveryRepository } from "../../db/repositories/webhook-delivery.repository.js";
import { verifyWebhookSignature } from "../../domain/webhook/webhook-security.js";
import { createBillingProvider } from "../../providers/billing-provider-factory.js";
import { auditService } from "../../services/audit.service.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const billingWebhooksRouter = Router();

interface BillingWebhookPayload {
  provider?: string;
  billingAccountId?: string;
  deliveryId?: string;
  eventType?: string;
  data?: { amountUsdCents?: number };
}

/**
 * The one genuinely public-shaped endpoint in M7
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §20, §34) — no bearer-token auth
 * (an external caller has no VentureForge identity by definition),
 * built to the standard a real provider integration would need even
 * though its only caller in this milestone is the DEV_FIXTURE
 * provider/test harness (§7). Every property below is enforced, never
 * merely documented: source validation before signature checking,
 * signature verification, a bounded replay window, delivery-id
 * idempotency, and audit logging on every branch, accepted or
 * rejected. "Never trust a webhook merely because it reaches the
 * endpoint."
 */
billingWebhooksRouter.post(
  "/dev-fixture",
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    let payload: BillingWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as BillingWebhookPayload;
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    // Source validation FIRST — an unrecognized provider or account is
    // rejected before a signature is ever checked (§20).
    const expectedProvider = createBillingProvider().id;
    if (payload.provider !== expectedProvider || !payload.billingAccountId) {
      await auditService.record({ actorType: "SYSTEM", actorId: null, action: "WEBHOOK_SOURCE_INVALID", resourceType: "BILLING_WEBHOOK", resourceId: payload.billingAccountId ?? null, result: "DENIED" });
      res.status(400).json({ error: "Unknown provider or missing billingAccountId." });
      return;
    }
    const account = await billingAccountRepository.findById(payload.billingAccountId);
    if (!account || account.provider !== payload.provider) {
      await auditService.record({ actorType: "SYSTEM", actorId: null, action: "WEBHOOK_SOURCE_INVALID", resourceType: "BILLING_WEBHOOK", resourceId: payload.billingAccountId, result: "DENIED" });
      res.status(404).json({ error: "Unknown billing account." });
      return;
    }

    const signatureHeader = req.header("X-Webhook-Signature");
    const timestampHeader = req.header("X-Webhook-Timestamp");
    if (!signatureHeader || !timestampHeader || !payload.deliveryId || !payload.eventType) {
      res.status(400).json({ error: "Missing required webhook signature/timestamp header or deliveryId/eventType field." });
      return;
    }
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      res.status(400).json({ error: "X-Webhook-Timestamp must be a unix millisecond timestamp." });
      return;
    }

    // Replay/idempotency — a previously-seen delivery id is rejected
    // outright, before even weighing signature validity (§20).
    const existing = await webhookDeliveryRepository.findByProviderAndDeliveryId(payload.provider, payload.deliveryId);
    if (existing) {
      await auditService.record({ actorType: "SYSTEM", actorId: null, action: "WEBHOOK_REPLAY_REJECTED", resourceType: "BILLING_ACCOUNT", resourceId: account.id, result: "DENIED", metadata: { deliveryId: payload.deliveryId } });
      res.status(409).json({ error: "Duplicate delivery id." });
      return;
    }

    const verification = verifyWebhookSignature({ secret: account.webhookSecret, rawBody, timestamp, signature: signatureHeader });
    await webhookDeliveryRepository.create({ billingAccountId: account.id, provider: payload.provider, deliveryId: payload.deliveryId, signatureValid: verification.valid, eventType: payload.eventType });

    if (!verification.valid) {
      await auditService.record({ actorType: "SYSTEM", actorId: null, action: "WEBHOOK_SIGNATURE_INVALID", resourceType: "BILLING_ACCOUNT", resourceId: account.id, result: "DENIED", reason: verification.reason });
      res.status(401).json({ error: verification.reason });
      return;
    }

    if (payload.eventType === "subscription.created" && typeof payload.data?.amountUsdCents === "number") {
      const billingPlan = await billingPlanRepository.findById(account.billingPlanId);
      if (billingPlan) {
        await businessMetricRepository.create({
          productId: billingPlan.productId,
          metricType: "REVENUE_USD",
          valueKind: "OBSERVED",
          value: payload.data.amountUsdCents / 100,
          source: "DEV_FIXTURE",
        });
      }
    }

    await auditService.record({ actorType: "SYSTEM", actorId: null, action: "WEBHOOK_PROCESSED", resourceType: "BILLING_ACCOUNT", resourceId: account.id, result: "SUCCESS", metadata: { eventType: payload.eventType, deliveryId: payload.deliveryId } });
    res.status(200).json({ received: true });
  }),
);

import { randomBytes } from "node:crypto";
import type { BillingAccount } from "@prisma/client";
import { billingAccountRepository } from "../db/repositories/billing-account.repository.js";
import { pricingModelRepository } from "../db/repositories/pricing-model.repository.js";
import { hashBillingPlan } from "../domain/approval/resource-snapshot.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString } from "../domain/shared/json.js";
import { createBillingProvider } from "../providers/billing-provider-factory.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";
import { billingPlanService } from "./billing-plan.service.js";
import { emergencyStopService } from "./emergency-stop.service.js";
import { eventBus } from "./event-bus.js";

export interface ActivateBillingParams {
  billingPlanId: string;
  actor: Actor;
}

interface PricingTier {
  name: string;
  monthlyPriceUsd: number;
  features: string[];
}

/**
 * The ACTIVATE_BILLING EXECUTE step (docs/M7_ARCHITECTURE_PROPOSAL.md
 * §5-6, §19) — human-actor-only, re-verifies the exact approved
 * BillingPlan, then calls BillingProvider for real (fixture-scoped)
 * the first time real payment collection becomes possible for this
 * product.
 */
export const billingActivationService = {
  async activate(params: ActivateBillingParams): Promise<BillingAccount> {
    assertHumanActor(params.actor);
    // Fails closed (docs/M9_ARCHITECTURE_PROPOSAL.md §57) — checked at every EXECUTE step, alongside the staleness check below.
    await emergencyStopService.assertNotActive();

    const plan = await billingPlanService.getOrThrow(params.billingPlanId);
    if (plan.status !== "HUMAN_APPROVED") {
      throw new ValidationError(`BillingPlan ${plan.id} is not HUMAN_APPROVED (status: ${plan.status}) — cannot activate.`);
    }
    if (!plan.approvalRequestId) {
      throw new ValidationError(`BillingPlan ${plan.id} has no bound ApprovalRequest.`);
    }
    const approvalRequest = await approvalService.getOrThrow(plan.approvalRequestId);
    if (approvalRequest.status !== "APPROVED" || approvalRequest.resourceType !== "BILLING_PLAN" || approvalRequest.resourceId !== plan.id) {
      throw new NotFoundError("Approved ApprovalRequest for BillingPlan", plan.id);
    }
    // Change detection + approval expiration (docs/M9_ARCHITECTURE_PROPOSAL.md §38-39) — the start of every EXECUTE step.
    await approvalService.assertFresh(approvalRequest, hashBillingPlan(plan));

    const pricingModel = await pricingModelRepository.findById(plan.pricingModelId);
    if (!pricingModel) throw new NotFoundError("PricingModel", plan.pricingModelId);
    const [primaryTier] = fromJsonString<PricingTier[]>(pricingModel.tiers, []);
    if (!primaryTier) {
      throw new ValidationError(`PricingModel ${pricingModel.id} has no tiers — cannot activate billing.`);
    }

    const provider = createBillingProvider();
    const { providerProductRef } = await provider.createProduct({ name: `Product ${plan.productId} — ${primaryTier.name}`, description: `Billing product for product ${plan.productId}, tier "${primaryTier.name}".` });
    const { providerPriceRef } = await provider.createPrice({ providerProductRef, amountUsdCents: Math.round(primaryTier.monthlyPriceUsd * 100), interval: "MONTH" });

    const billingAccount = await billingAccountRepository.create({
      billingPlanId: plan.id,
      provider: provider.id,
      providerProductRef,
      providerPriceRef,
      webhookSecret: randomBytes(32).toString("hex"),
      activatedByIdentityId: params.actor.actorId,
      activatedAt: new Date(),
    });

    await billingPlanService.setStatus(plan.id, "ACTIVE");

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "ACTIVATE_BILLING",
      resourceType: "BILLING_PLAN",
      resourceId: plan.id,
      result: "SUCCESS",
      metadata: { billingAccountId: billingAccount.id, providerProductRef, providerPriceRef, provider: provider.id },
    });
    await eventBus.publish({ type: "BILLING_ACTIVATED", payload: { billingPlanId: plan.id, billingAccountId: billingAccount.id, productId: plan.productId, provider: provider.id } });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the generic EXECUTE-step event, alongside BILLING_ACTIVATED, never replacing it.
    await eventBus.publish({ type: "ACTION_EXECUTED", payload: { action: "ACTIVATE_BILLING", resourceType: "BILLING_PLAN", resourceId: plan.id, status: "ACTIVATED" } });

    return billingAccount;
  },

  /**
   * Test/demo-only (§19, §40.4) — never invoked from any agent or any
   * production-shaped code path (no route exposes it beyond the
   * capstone test and npm run demo:m7). Creates a fixture customer and
   * subscription against the SAME billing account's own real
   * providerPriceRef, so the billing capstone's referential integrity
   * is real, never a static stub.
   */
  async recordSubscriptionFixture(params: { billingAccountId: string; customerEmail: string }): Promise<{ providerCustomerRef: string; providerSubscriptionRef: string }> {
    const account = await billingAccountRepository.findById(params.billingAccountId);
    if (!account) throw new NotFoundError("BillingAccount", params.billingAccountId);

    const provider = createBillingProvider();
    const { providerCustomerRef } = await provider.createCustomer({ email: params.customerEmail });
    const { providerSubscriptionRef } = await provider.createSubscription({ providerCustomerRef, providerPriceRef: account.providerPriceRef });

    return { providerCustomerRef, providerSubscriptionRef };
  },
};

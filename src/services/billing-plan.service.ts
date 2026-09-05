import type { ApprovalRequest, BillingPlan } from "@prisma/client";
import { billingPlanRepository } from "../db/repositories/billing-plan.repository.js";
import { pricingModelRepository } from "../db/repositories/pricing-model.repository.js";
import { hashBillingPlan } from "../domain/approval/resource-snapshot.js";
import { BILLING_PLAN_STATUS_TRANSITIONS, isBillingPlanStatus } from "../domain/billing-plan/billing-plan.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { assertHumanOrSystemActor, type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { auditService } from "./audit.service.js";

export interface CreateBillingPlanParams {
  productId: string;
  pricingModelId: string;
  provider: string;
}

export interface RequestBillingPlanApprovalParams {
  billingPlanId: string;
  requestedByAgentId: string;
}

export interface ApplyBillingPlanDecisionParams {
  approvalRequestId: string;
  actor: Actor;
}

/**
 * The RED-tier human-approval gate on a BillingPlan
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §5-6, §19) — mirrors
 * deploymentPlanService exactly. `create` is a mechanical wrapping of
 * an already-judged PricingModel into billing-approval shape — no
 * separate "Billing Agent" judgment is needed beyond what the Pricing
 * Agent already produced (§21).
 */
export const billingPlanService = {
  async create(params: CreateBillingPlanParams): Promise<BillingPlan> {
    const pricingModel = await pricingModelRepository.findById(params.pricingModelId);
    if (!pricingModel || pricingModel.productId !== params.productId) {
      throw new ValidationError(`PricingModel ${params.pricingModelId} does not belong to product ${params.productId}.`);
    }
    return billingPlanRepository.create({ productId: params.productId, pricingModelId: params.pricingModelId, provider: params.provider });
  },

  async getOrThrow(id: string): Promise<BillingPlan> {
    const plan = await billingPlanRepository.findById(id);
    if (!plan) throw new NotFoundError("BillingPlan", id);
    return plan;
  },

  async setStatus(id: string, toStatus: string): Promise<BillingPlan> {
    if (!isBillingPlanStatus(toStatus)) throw new ValidationError(`Unknown billing plan status: ${toStatus}`);
    const plan = await billingPlanService.getOrThrow(id);
    if (!isBillingPlanStatus(plan.status)) throw new ValidationError(`Corrupt stored status on billing plan ${plan.id}: ${plan.status}`);
    assertTransition("BillingPlan", BILLING_PLAN_STATUS_TRANSITIONS, plan.status, toStatus);
    return billingPlanRepository.updateStatus(id, toStatus);
  },

  /** DRAFT stays DRAFT until decided — a real RED-risk ApprovalRequest bound to this exact plan id (§19). */
  async requestApproval(params: RequestBillingPlanApprovalParams): Promise<ApprovalRequest> {
    const plan = await billingPlanService.getOrThrow(params.billingPlanId);
    if (plan.status !== "DRAFT") {
      throw new ValidationError(`BillingPlan ${plan.id} is not DRAFT (status: ${plan.status}) — approval may only be requested for a fresh plan.`);
    }

    const approvalRequest = await approvalService.requestApproval({
      requestedByAgentId: params.requestedByAgentId,
      action: "ACTIVATE_BILLING",
      description: `Approve activating billing (provider=${plan.provider}) for product ${plan.productId}.`,
      riskLevel: "RED",
      resourceType: "BILLING_PLAN",
      resourceId: plan.id,
      resourceStateHash: hashBillingPlan(plan),
    });

    await billingPlanRepository.attachApprovalRequest(plan.id, approvalRequest.id);

    await auditService.record({
      actorType: "AGENT",
      actorId: params.requestedByAgentId,
      action: "REQUEST_BILLING_PLAN_APPROVAL",
      resourceType: "BILLING_PLAN",
      resourceId: plan.id,
      result: "SUCCESS",
      metadata: { approvalRequestId: approvalRequest.id },
    });

    return approvalRequest;
  },

  /**
   * Mirrors deploymentPlanService.applyDecision exactly — never itself
   * activates billing; APPROVED only ever reaches HUMAN_APPROVED, a
   * status that still requires a separate, explicit
   * billingActivationService.activate call.
   */
  async applyDecision(params: ApplyBillingPlanDecisionParams): Promise<BillingPlan> {
    assertHumanOrSystemActor(params.actor);

    const approvalRequest = await approvalService.getOrThrow(params.approvalRequestId);
    if (approvalRequest.resourceType !== "BILLING_PLAN" || !approvalRequest.resourceId) {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} is not tied to a BillingPlan.`);
    }
    if (approvalRequest.status !== "APPROVED" && approvalRequest.status !== "REJECTED") {
      throw new ValidationError(`ApprovalRequest ${approvalRequest.id} has not been decided yet (status: ${approvalRequest.status}).`);
    }

    const plan = await billingPlanService.getOrThrow(approvalRequest.resourceId);
    if (plan.status === "HUMAN_APPROVED" || plan.status === "REJECTED" || plan.status === "ACTIVE") {
      return plan; // Idempotent — already applied.
    }

    const toStatus = approvalRequest.status === "APPROVED" ? "HUMAN_APPROVED" : "REJECTED";
    const updated = await billingPlanService.setStatus(plan.id, toStatus);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `BILLING_PLAN_${plan.status}_TO_${toStatus}`,
      resourceType: "BILLING_PLAN",
      resourceId: plan.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

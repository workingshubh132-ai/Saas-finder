import type { CeoRecommendation, ChairmanReview, DeploymentPlan, GoToMarketPlan, LaunchPlan, LaunchReviewMemo, PricingModel, Product } from "@prisma/client";
import { launchPlanRepository } from "../db/repositories/launch-plan.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { auditService } from "./audit.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { chairmanService } from "./chairman.service.js";
import { gtmAgentService } from "./gtm-agent.service.js";
import { launchReviewMemoService } from "./launch-review-memo.service.js";
import { launchStrategistService } from "./launch-strategist.service.js";
import { pricingAgentService } from "./pricing-agent.service.js";
import { productService } from "./product.service.js";

export interface PlanLaunchParams {
  productId: string;
  launchStrategistAgentId: string;
  pricingAgentId: string;
  gtmAgentId: string;
  ceoAgentId: string;
  startedBy: AuthenticatedActor;
}

export interface LaunchOperationsSummary {
  product: Product;
  launchPlan: LaunchPlan | null;
  deploymentPlan: DeploymentPlan | null;
  pricingModel: PricingModel | null;
  goToMarketPlan: GoToMarketPlan | null;
  ceoRecommendation: CeoRecommendation | null;
  chairmanReview: ChairmanReview | null;
  memo: LaunchReviewMemo | null;
  stoppedReason: string | null;
}

function toActor(startedBy: AuthenticatedActor): { actorType: "HUMAN" | "AGENT" | "SYSTEM"; actorId: string } {
  return { actorType: startedBy.type, actorId: startedBy.id };
}

/**
 * The launch-planning orchestrator (docs/M7_ARCHITECTURE_PROPOSAL.md
 * §5, §17, §28-31) — deterministic orchestration CODE, layered on top
 * of unmodified agent services, mirroring productFactoryService's own
 * precedent (M6) exactly: drives a Product through LAUNCH_PLANNING to
 * AWAITING_LAUNCH_APPROVAL, stops cleanly and preserves every
 * already-committed row on any failure, never rolls back partial work.
 * This is PLANNING only — it never requests a DeploymentPlan's own
 * approval and never deploys, bills, or spends anything (§5's own
 * PLAN/APPROVE/EXECUTE separation).
 */
export const launchOperationsService = {
  async planLaunch(params: PlanLaunchParams): Promise<LaunchOperationsSummary> {
    let product = await productService.getOrThrow(params.productId);
    if (product.status !== "READY_FOR_DEPLOYMENT" && product.status !== "LAUNCH_PLANNING") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — launch planning only runs once a build is READY_FOR_DEPLOYMENT (or already LAUNCH_PLANNING, for a rework pass).`);
    }
    const actor = toActor(params.startedBy);

    let launchPlan: LaunchPlan | null = null;
    let deploymentPlan: DeploymentPlan | null = null;
    let pricingModel: PricingModel | null = null;
    let goToMarketPlan: GoToMarketPlan | null = null;

    const fail = async (reason: string): Promise<LaunchOperationsSummary> => {
      product = await productService.setStatus(product.id, "FAILED", actor);
      await auditService.record({ actorType: actor.actorType, actorId: actor.actorId, action: "LAUNCH_OPERATIONS_STOPPED", resourceType: "PRODUCT", resourceId: product.id, result: "FAILURE", reason });
      return { product, launchPlan, deploymentPlan, pricingModel, goToMarketPlan, ceoRecommendation: null, chairmanReview: null, memo: null, stoppedReason: reason };
    };

    if (product.status === "READY_FOR_DEPLOYMENT") {
      product = await productService.setStatus(product.id, "LAUNCH_PLANNING", actor);
    }

    const strategistOutcome = await launchStrategistService.run({ agentId: params.launchStrategistAgentId, productId: product.id, startedBy: params.startedBy });
    if (strategistOutcome.status !== "COMPLETED") return fail("Launch Strategist did not complete.");
    deploymentPlan = strategistOutcome.result.deploymentPlan;
    launchPlan = strategistOutcome.result.launchPlan;

    const pricingOutcome = await pricingAgentService.run({ agentId: params.pricingAgentId, productId: product.id, startedBy: params.startedBy });
    if (pricingOutcome.status !== "COMPLETED") return fail("Pricing Agent did not complete.");
    pricingModel = pricingOutcome.result.pricingModel;
    launchPlan = await launchPlanRepository.attachPricingModel(launchPlan.id, pricingModel.id);

    const gtmOutcome = await gtmAgentService.run({ agentId: params.gtmAgentId, productId: product.id, startedBy: params.startedBy });
    if (gtmOutcome.status !== "COMPLETED") return fail("GTM Agent did not complete.");
    goToMarketPlan = gtmOutcome.result.goToMarketPlan;
    launchPlan = await launchPlanRepository.attachGoToMarketPlan(launchPlan.id, goToMarketPlan.id);

    const ceoOutcome = await ceoReasoningService.recommendLaunchOperationsAction({ agentId: params.ceoAgentId, productId: product.id, startedBy: params.startedBy });
    if (ceoOutcome.status !== "COMPLETED") return fail("CEO launch-operations recommendation did not complete.");
    const ceoRecommendation = ceoOutcome.result.recommendation;

    const { review: chairmanReview } = await chairmanService.reviewLaunch({ productId: product.id, reviewedBy: params.startedBy });

    const memo = await launchReviewMemoService.compile({ productId: product.id, launchPlan, ceoRecommendation, chairmanReview, actor });

    product = await productService.setStatus(product.id, "AWAITING_LAUNCH_APPROVAL", actor);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "LAUNCH_OPERATIONS_PLANNING_COMPLETED",
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: "SUCCESS",
      metadata: { launchPlanId: launchPlan.id, ceoAction: ceoRecommendation.action, chairmanDecision: chairmanReview.decision, memoId: memo.id },
    });

    return { product, launchPlan, deploymentPlan, pricingModel, goToMarketPlan, ceoRecommendation, chairmanReview, memo, stoppedReason: null };
  },
};

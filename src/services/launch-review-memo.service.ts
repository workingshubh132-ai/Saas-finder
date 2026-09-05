import type { CeoRecommendation, ChairmanReview, DeploymentPlan, GoToMarketPlan, LaunchPlan, LaunchReviewMemo, PricingModel } from "@prisma/client";
import { deploymentPlanRepository } from "../db/repositories/deployment-plan.repository.js";
import { goToMarketPlanRepository } from "../db/repositories/go-to-market-plan.repository.js";
import { launchReviewMemoRepository } from "../db/repositories/launch-review-memo.repository.js";
import { pricingModelRepository } from "../db/repositories/pricing-model.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { isLaunchReviewHumanDecision } from "../domain/launch-review-memo/launch-review-memo.types.js";
import type { UnitEconomics } from "../domain/pricing-model/unit-economics.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { productService } from "./product.service.js";

export interface CompileLaunchReviewMemoParams {
  productId: string;
  launchPlan: LaunchPlan;
  ceoRecommendation: CeoRecommendation;
  chairmanReview: ChairmanReview;
  actor: Actor;
}

interface MemoContent {
  deploymentSummary: { environment: string; strategy: string; estimatedCostUsd: number; budgetExceeded: boolean; rollbackPlan: string } | null;
  pricingSummary: { tiers: unknown; unitEconomics: UnitEconomics } | null;
  gtmSummary: { channels: unknown; landingPageSpec: unknown; experiments: unknown } | null;
  ceoRecommendation: { action: string; reasoning: string; confidence: number };
  chairmanReview: { decision: string; objections: string[]; missingEvidence: string[]; confidence: number };
  strongestObjection: string | null;
}

/**
 * Compiles the LaunchReviewMemo (docs/M7_ARCHITECTURE_PROPOSAL.md §31)
 * — zero new model calls, mirrors productReviewMemoService.compile
 * exactly: every fact here was already computed by a real prior agent
 * step, this service only assembles and persists the one document a
 * human actually reads before deciding whether to pursue this launch.
 */
export const launchReviewMemoService = {
  async compile(params: CompileLaunchReviewMemoParams): Promise<LaunchReviewMemo> {
    if (params.launchPlan.productId !== params.productId) {
      throw new ValidationError("LaunchPlan does not belong to the given Product.");
    }

    const [deploymentPlan, pricingModel, goToMarketPlan]: [DeploymentPlan | null, PricingModel | null, GoToMarketPlan | null] = await Promise.all([
      params.launchPlan.deploymentPlanId ? deploymentPlanRepository.findById(params.launchPlan.deploymentPlanId) : Promise.resolve(null),
      params.launchPlan.pricingModelId ? pricingModelRepository.findById(params.launchPlan.pricingModelId) : Promise.resolve(null),
      params.launchPlan.goToMarketPlanId ? goToMarketPlanRepository.findById(params.launchPlan.goToMarketPlanId) : Promise.resolve(null),
    ]);

    const objections = fromJsonString<string[]>(params.chairmanReview.objections, []);

    const content: MemoContent = {
      deploymentSummary: deploymentPlan
        ? { environment: deploymentPlan.environment, strategy: deploymentPlan.strategy, estimatedCostUsd: deploymentPlan.estimatedCostUsd, budgetExceeded: deploymentPlan.budgetExceeded, rollbackPlan: deploymentPlan.rollbackPlan }
        : null,
      pricingSummary: pricingModel
        ? { tiers: fromJsonString<unknown>(pricingModel.tiers, []), unitEconomics: fromJsonString<UnitEconomics>(pricingModel.unitEconomics, { costPerCustomerUsd: 0, grossMarginUsd: 0, grossMarginPct: 0, reasoning: "" }) }
        : null,
      gtmSummary: goToMarketPlan
        ? { channels: fromJsonString<unknown>(goToMarketPlan.channels, []), landingPageSpec: fromJsonString<unknown>(goToMarketPlan.landingPageSpec, {}), experiments: fromJsonString<unknown>(goToMarketPlan.experiments, []) }
        : null,
      ceoRecommendation: { action: params.ceoRecommendation.action, reasoning: params.ceoRecommendation.reasoning, confidence: params.ceoRecommendation.confidence },
      chairmanReview: { decision: params.chairmanReview.decision, objections, missingEvidence: fromJsonString<string[]>(params.chairmanReview.missingEvidence, []), confidence: params.chairmanReview.confidence },
      strongestObjection: objections[0] ?? null,
    };

    const memo = await launchReviewMemoRepository.create({
      productId: params.productId,
      launchPlanId: params.launchPlan.id,
      ceoRecommendationId: params.ceoRecommendation.id,
      chairmanReviewId: params.chairmanReview.id,
      content: toJsonString(content),
      recommendation: `${params.chairmanReview.decision}: ${params.chairmanReview.recommendation}`,
      confidence: Math.min(params.ceoRecommendation.confidence, params.chairmanReview.confidence),
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "COMPILE_LAUNCH_REVIEW_MEMO",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, chairmanDecision: params.chairmanReview.decision, ceoAction: params.ceoRecommendation.action },
    });
    await eventBus.publish({ type: "LAUNCH_REVIEW_MEMO_CREATED", payload: { memoId: memo.id, productId: params.productId } });

    return memo;
  },

  getOrThrow: async (id: string): Promise<LaunchReviewMemo> => {
    const memo = await launchReviewMemoRepository.findById(id);
    if (!memo) throw new NotFoundError("LaunchReviewMemo", id);
    return memo;
  },

  listForProduct: async (productId: string): Promise<LaunchReviewMemo[]> => {
    const memo = await launchReviewMemoRepository.findLatestForProduct(productId);
    return memo ? [memo] : [];
  },

  /**
   * The Human Owner's decision on a compiled memo
   * (docs/M7_ARCHITECTURE_PROPOSAL.md §31) — mirrors
   * productReviewMemoService.recordHumanDecision's own
   * simple-direct-transition shape: APPROVE leaves Product at
   * AWAITING_LAUNCH_APPROVAL (a human separately requests the
   * DeploymentPlan's own RED-tier approval next, §5-6 — this decision
   * alone never triggers a deployment); REJECT -> FAILED; REQUEST_CHANGES
   * -> LAUNCH_PLANNING (a bounded rework pass); DEFER leaves Product
   * unchanged (recorded, no forcing function yet).
   */
  async recordHumanDecision(params: { memoId: string; humanDecision: string; humanReason: string | null; actor: Actor }): Promise<LaunchReviewMemo> {
    assertHumanActor(params.actor);
    if (!isLaunchReviewHumanDecision(params.humanDecision)) {
      throw new ValidationError(`Unknown launch review human decision: ${params.humanDecision}`);
    }
    const memo = await launchReviewMemoService.getOrThrow(params.memoId);
    if (memo.humanDecision !== null) {
      throw new ValidationError(`LaunchReviewMemo ${memo.id} already has a human decision (${memo.humanDecision}) — a decision is recorded exactly once.`);
    }

    const updated = await launchReviewMemoRepository.recordHumanDecision(params.memoId, {
      humanDecision: params.humanDecision,
      humanReason: params.humanReason,
      decidedByIdentityId: params.actor.actorId,
    });

    const product = await productRepository.findById(memo.productId);
    if (!product) throw new NotFoundError("Product", memo.productId);
    const nextStatus = params.humanDecision === "REJECT" ? "FAILED" : params.humanDecision === "REQUEST_CHANGES" ? "LAUNCH_PLANNING" : null;
    if (nextStatus) {
      await productService.setStatus(product.id, nextStatus, { actorType: params.actor.actorType, actorId: params.actor.actorId });
    }

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `LAUNCH_REVIEW_MEMO_HUMAN_DECISION_${params.humanDecision}`,
      resourceType: "PRODUCT",
      resourceId: memo.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, humanReason: params.humanReason },
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the one cross-milestone event decisionQueueService's own unification (§19) makes real at the event layer.
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "LAUNCH_REVIEW_MEMO", memoId: updated.id, decision: params.humanDecision } });

    return updated;
  },
};

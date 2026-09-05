import type { BusinessHealth, BusinessReviewMemo, CeoRecommendation, ChairmanReview } from "@prisma/client";
import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { isBusinessReviewHumanDecision } from "../domain/business-review-memo/business-review-memo.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { productService } from "./product.service.js";

export interface CompileBusinessReviewMemoParams {
  productId: string;
  businessHealth: BusinessHealth;
  ceoRecommendation: CeoRecommendation;
  chairmanReview: ChairmanReview;
  actor: Actor;
}

interface MemoContent {
  businessHealth: { state: string; compositeScore: number; dimensions: Record<string, number> };
  ceoRecommendation: { action: string; reasoning: string; confidence: number };
  chairmanReview: { decision: string; objections: string[]; missingEvidence: string[]; confidence: number };
  strongestObjection: string | null;
}

/** CEO actions consequential enough that a human APPROVE also pauses the product — a real, reversible, already-existing transition, never a new autonomous terminal state (docs/M8_ARCHITECTURE_PROPOSAL.md §25, §42). */
const ACTIONS_THAT_PAUSE_ON_APPROVAL = new Set(["PREPARE_KILL_REVIEW", "KILL"]);

/**
 * Compiles the BusinessReviewMemo (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §23, §25) — zero new model calls, mirrors launchReviewMemoService's
 * own shape exactly: every fact here was already computed by a real
 * prior step; this service only assembles and persists the one
 * document a human actually reads before deciding.
 */
export const businessReviewMemoService = {
  async compile(params: CompileBusinessReviewMemoParams): Promise<BusinessReviewMemo> {
    const objections = fromJsonString<string[]>(params.chairmanReview.objections, []);

    const content: MemoContent = {
      businessHealth: {
        state: params.businessHealth.state,
        compositeScore: params.businessHealth.compositeScore,
        dimensions: {
          productHealth: params.businessHealth.productHealth,
          customerHealth: params.businessHealth.customerHealth,
          revenueHealth: params.businessHealth.revenueHealth,
          growthHealth: params.businessHealth.growthHealth,
          marginHealth: params.businessHealth.marginHealth,
          operationalHealth: params.businessHealth.operationalHealth,
          risk: params.businessHealth.risk,
          evidenceConfidence: params.businessHealth.evidenceConfidence,
        },
      },
      ceoRecommendation: { action: params.ceoRecommendation.action, reasoning: params.ceoRecommendation.reasoning, confidence: params.ceoRecommendation.confidence },
      chairmanReview: { decision: params.chairmanReview.decision, objections, missingEvidence: fromJsonString<string[]>(params.chairmanReview.missingEvidence, []), confidence: params.chairmanReview.confidence },
      strongestObjection: objections[0] ?? null,
    };

    const memo = await businessReviewMemoRepository.create({
      productId: params.productId,
      ceoRecommendationId: params.ceoRecommendation.id,
      chairmanReviewId: params.chairmanReview.id,
      content: toJsonString(content),
      recommendation: params.ceoRecommendation.action,
      confidence: Math.min(params.ceoRecommendation.confidence, params.chairmanReview.confidence),
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "COMPILE_BUSINESS_REVIEW_MEMO",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, chairmanDecision: params.chairmanReview.decision, ceoAction: params.ceoRecommendation.action },
    });
    // Was mis-published as "LAUNCH_REVIEW_MEMO_CREATED" (a copy-paste from launch-review-memo.service.ts) —
    // caught and fixed by the M9 audit (docs/M9_ARCHITECTURE_PROPOSAL.md §8, docs/DECISIONS.md).
    await eventBus.publish({ type: "BUSINESS_REVIEW_MEMO_CREATED", payload: { memoId: memo.id, productId: params.productId } });

    return memo;
  },

  async getOrThrow(id: string): Promise<BusinessReviewMemo> {
    const memo = await businessReviewMemoRepository.findById(id);
    if (!memo) throw new NotFoundError("BusinessReviewMemo", id);
    return memo;
  },

  listForProduct(productId: string): Promise<BusinessReviewMemo[]> {
    return businessReviewMemoRepository.listForProduct(productId);
  },

  /**
   * The Human Owner's decision on a compiled memo
   * (docs/M8_ARCHITECTURE_PROPOSAL.md §25) — APPROVE on a
   * PREPARE_KILL_REVIEW/KILL recommendation moves a LIVE product to
   * PAUSED (a real, already-existing, reversible transition — never a
   * new autonomous terminal state); every other action is strategic
   * guidance and leaves Product status untouched. REJECT/REQUEST_CHANGES/
   * DEFER never change Product status either way.
   */
  async recordHumanDecision(params: { memoId: string; humanDecision: string; humanReason: string | null; actor: Actor }): Promise<BusinessReviewMemo> {
    assertHumanActor(params.actor);
    if (!isBusinessReviewHumanDecision(params.humanDecision)) {
      throw new ValidationError(`Unknown business review human decision: ${params.humanDecision}`);
    }
    const memo = await businessReviewMemoService.getOrThrow(params.memoId);
    if (memo.humanDecision !== null) {
      throw new ValidationError(`BusinessReviewMemo ${memo.id} already has a human decision (${memo.humanDecision}) — a decision is recorded exactly once.`);
    }

    const updated = await businessReviewMemoRepository.recordHumanDecision(params.memoId, params.humanDecision, params.humanReason, params.actor.actorId);

    if (params.humanDecision === "APPROVE" && ACTIONS_THAT_PAUSE_ON_APPROVAL.has(memo.recommendation)) {
      const product = await productRepository.findById(memo.productId);
      if (!product) throw new NotFoundError("Product", memo.productId);
      if (product.status === "LIVE") {
        await productService.setStatus(product.id, "PAUSED", { actorType: params.actor.actorType, actorId: params.actor.actorId });
      }
    }

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `BUSINESS_REVIEW_MEMO_HUMAN_DECISION_${params.humanDecision}`,
      resourceType: "PRODUCT",
      resourceId: memo.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, humanReason: params.humanReason },
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the one cross-milestone event decisionQueueService's own unification (§19) makes real at the event layer.
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "BUSINESS_REVIEW_MEMO", memoId: updated.id, decision: params.humanDecision } });

    return updated;
  },
};

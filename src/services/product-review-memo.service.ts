import type { CeoRecommendation, ChairmanReview, EngineeringTask, MvpArchitecture, ProductReviewMemo, ProductSpec } from "@prisma/client";
import { codeReviewRepository } from "../db/repositories/code-review.repository.js";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import { productReviewMemoRepository } from "../db/repositories/product-review-memo.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { qaReportRepository } from "../db/repositories/qa-report.repository.js";
import { securityReviewRepository } from "../db/repositories/security-review.repository.js";
import { isProductReviewHumanDecision } from "../domain/product-review-memo/product-review-memo.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { productService } from "./product.service.js";

export interface CompileProductReviewMemoParams {
  productId: string;
  productSpec: ProductSpec;
  mvpArchitecture: MvpArchitecture;
  ceoRecommendation: CeoRecommendation;
  chairmanReview: ChairmanReview;
  actor: Actor;
}

interface MemoContent {
  productThesis: unknown;
  targetCustomer: string;
  coreProblem: string;
  mvpBoundary: unknown;
  nonGoals: string[];
  architectureSummary: { backend: unknown; database: unknown; authentication: unknown; deploymentStrategy: unknown };
  engineeringSummary: { tasksTotal: number; tasksCompleted: number; filesChanged: string[] };
  codeReviewSummary: { tasksReviewed: number; blockingFindingCount: number };
  qaSummary: { tasksReviewed: number; failCount: number; passWithGapsCount: number };
  securitySummary: { tasksReviewed: number; failCount: number; totalFindingCount: number };
  ceoRecommendation: { action: string; reasoning: string; confidence: number };
  chairmanReview: { decision: string; objections: string[]; missingEvidence: string[]; confidence: number };
  strongestObjection: string | null;
}

/**
 * Compiles the ProductReviewMemo (docs/M6_ARCHITECTURE_PROPOSAL.md
 * §34-35, brief §42) — zero new model calls, exactly like
 * investmentMemoService/customerDiscoveryMemoService before it: every
 * fact here was already computed by a real prior agent step, this
 * service only assembles and persists the one document a human
 * actually reads.
 */
export const productReviewMemoService = {
  async compile(params: CompileProductReviewMemoParams): Promise<ProductReviewMemo> {
    if (params.productSpec.productId !== params.productId || params.mvpArchitecture.productId !== params.productId) {
      throw new ValidationError("ProductSpec/MvpArchitecture do not belong to the given Product.");
    }

    const tasks = await engineeringTaskRepository.listForProduct(params.productId);
    const filesChanged = new Set<string>();
    let blockingFindingCount = 0;
    let tasksCodeReviewed = 0;
    let qaFailCount = 0;
    let qaPassWithGapsCount = 0;
    let tasksQaReviewed = 0;
    let securityFailCount = 0;
    let securityFindingCount = 0;
    let tasksSecurityReviewed = 0;

    for (const task of tasks) {
      for (const f of fromJsonString<string[]>(task.filesChanged ?? "[]", [])) filesChanged.add(f);

      const codeReview = await codeReviewRepository.findLatestForTask(task.id);
      if (codeReview) {
        tasksCodeReviewed += 1;
        if (codeReview.hasBlockingFinding) blockingFindingCount += 1;
      }
      const qaReport = await qaReportRepository.findLatestForTask(task.id);
      if (qaReport) {
        tasksQaReviewed += 1;
        if (qaReport.verdict === "FAIL") qaFailCount += 1;
        if (qaReport.verdict === "PASS_WITH_GAPS") qaPassWithGapsCount += 1;
      }
      const securityReview = await securityReviewRepository.findLatestForTask(task.id);
      if (securityReview) {
        tasksSecurityReviewed += 1;
        if (securityReview.verdict === "FAIL") securityFailCount += 1;
        securityFindingCount += fromJsonString<unknown[]>(securityReview.findings, []).length;
      }
    }

    const specContent = fromJsonString<{ productThesis: unknown; mvpBoundary: unknown }>(params.productSpec.content, { productThesis: null, mvpBoundary: null });
    const design = fromJsonString<{ backend: unknown; database: unknown; authentication: unknown; deploymentStrategy: unknown }>(params.mvpArchitecture.designJson, {
      backend: null,
      database: null,
      authentication: null,
      deploymentStrategy: null,
    });
    const objections = fromJsonString<string[]>(params.chairmanReview.objections, []);

    const content: MemoContent = {
      productThesis: specContent.productThesis,
      targetCustomer: params.productSpec.targetCustomer,
      coreProblem: params.productSpec.coreProblem,
      mvpBoundary: specContent.mvpBoundary,
      nonGoals: fromJsonString<string[]>(params.productSpec.nonGoals, []),
      architectureSummary: { backend: design.backend, database: design.database, authentication: design.authentication, deploymentStrategy: design.deploymentStrategy },
      engineeringSummary: { tasksTotal: tasks.length, tasksCompleted: tasks.filter((t: EngineeringTask) => t.status === "COMPLETED").length, filesChanged: [...filesChanged] },
      codeReviewSummary: { tasksReviewed: tasksCodeReviewed, blockingFindingCount },
      qaSummary: { tasksReviewed: tasksQaReviewed, failCount: qaFailCount, passWithGapsCount: qaPassWithGapsCount },
      securitySummary: { tasksReviewed: tasksSecurityReviewed, failCount: securityFailCount, totalFindingCount: securityFindingCount },
      ceoRecommendation: { action: params.ceoRecommendation.action, reasoning: params.ceoRecommendation.reasoning, confidence: params.ceoRecommendation.confidence },
      chairmanReview: { decision: params.chairmanReview.decision, objections, missingEvidence: fromJsonString<string[]>(params.chairmanReview.missingEvidence, []), confidence: params.chairmanReview.confidence },
      strongestObjection: objections[0] ?? null,
    };

    const memo = await productReviewMemoRepository.create({
      productId: params.productId,
      ceoRecommendationId: params.ceoRecommendation.id,
      chairmanReviewId: params.chairmanReview.id,
      content: toJsonString(content),
      recommendation: `${params.chairmanReview.decision}: ${params.chairmanReview.recommendation}`,
      confidence: Math.min(params.ceoRecommendation.confidence, params.chairmanReview.confidence),
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "COMPILE_PRODUCT_REVIEW_MEMO",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, chairmanDecision: params.chairmanReview.decision, ceoAction: params.ceoRecommendation.action },
    });
    await eventBus.publish({ type: "PRODUCT_REVIEW_MEMO_CREATED", payload: { memoId: memo.id, productId: params.productId } });

    return memo;
  },

  getOrThrow: async (id: string): Promise<ProductReviewMemo> => {
    const memo = await productReviewMemoRepository.findById(id);
    if (!memo) throw new NotFoundError("ProductReviewMemo", id);
    return memo;
  },

  listForProduct: productReviewMemoRepository.listForProduct,

  /**
   * The Human Owner's decision on a compiled memo (brief §22) — the
   * one place a decision on a Product build is actually applied,
   * mirroring productService.approve's own simple-direct-transition
   * shape: APPROVE -> READY_FOR_DEPLOYMENT, REJECT -> REJECTED,
   * REQUEST_CHANGES -> BUILDING (a bounded rework pass), DEFER leaves
   * Product in HUMAN_REVIEW (recorded, no forcing function yet).
   */
  async recordHumanDecision(params: { memoId: string; humanDecision: string; humanReason: string | null; actor: Actor }): Promise<ProductReviewMemo> {
    assertHumanActor(params.actor);
    if (!isProductReviewHumanDecision(params.humanDecision)) {
      throw new ValidationError(`Unknown product review human decision: ${params.humanDecision}`);
    }
    const memo = await productReviewMemoService.getOrThrow(params.memoId);
    if (memo.humanDecision !== null) {
      throw new ValidationError(`ProductReviewMemo ${memo.id} already has a human decision (${memo.humanDecision}) — a decision is recorded exactly once.`);
    }

    const updated = await productReviewMemoRepository.recordHumanDecision(params.memoId, {
      humanDecision: params.humanDecision,
      humanReason: params.humanReason,
      decidedByIdentityId: params.actor.actorId,
    });

    const product = await productRepository.findById(memo.productId);
    if (!product) throw new NotFoundError("Product", memo.productId);
    const nextStatus = params.humanDecision === "APPROVE" ? "READY_FOR_DEPLOYMENT" : params.humanDecision === "REJECT" ? "REJECTED" : params.humanDecision === "REQUEST_CHANGES" ? "BUILDING" : null;
    if (nextStatus) {
      await productService.setStatus(product.id, nextStatus, { actorType: params.actor.actorType, actorId: params.actor.actorId });
    }

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `PRODUCT_REVIEW_MEMO_HUMAN_DECISION_${params.humanDecision}`,
      resourceType: "PRODUCT",
      resourceId: memo.productId,
      result: "SUCCESS",
      metadata: { memoId: memo.id, humanReason: params.humanReason },
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the one cross-milestone event decisionQueueService's own unification (§19) makes real at the event layer.
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "PRODUCT_REVIEW_MEMO", memoId: updated.id, decision: params.humanDecision } });

    return updated;
  },
};

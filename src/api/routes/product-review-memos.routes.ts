import { Router } from "express";
import { z } from "zod";
import { PRODUCT_REVIEW_HUMAN_DECISIONS } from "../../domain/product-review-memo/product-review-memo.types.js";
import { calibrationService } from "../../services/calibration.service.js";
import { productReviewMemoService } from "../../services/product-review-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const productReviewMemosRouter = Router();

/**
 * Registered BEFORE the /:id route below: Express would otherwise
 * match "calibration-summary" as an :id parameter value, silently
 * shadowing this route (matches customer-discovery-memos.routes.ts's
 * own precedent).
 */
productReviewMemosRouter.get(
  "/calibration-summary",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    res.json(await calibrationService.summarizeProductBuilds());
  }),
);

productReviewMemosRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await productReviewMemoService.getOrThrow(requireParam(req, "id")));
  }),
);

const decideSchema = z.object({ humanDecision: z.enum(PRODUCT_REVIEW_HUMAN_DECISIONS), humanReason: z.string().nullable().optional() });

/** Human-Owner-only, exactly once (idempotent) — APPROVE/REQUEST_CHANGES/REJECT/DEFER (brief §22). */
productReviewMemosRouter.post(
  "/:id/decide",
  requireHuman(),
  validateBody(decideSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decideSchema>;
    const memo = await productReviewMemoService.recordHumanDecision({
      memoId: requireParam(req, "id"),
      humanDecision: body.humanDecision,
      humanReason: body.humanReason ?? null,
      actor: toActor(getActor(req)),
    });
    res.json(memo);
  }),
);

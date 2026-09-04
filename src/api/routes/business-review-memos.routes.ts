import { Router } from "express";
import { z } from "zod";
import { businessReviewMemoRepository } from "../../db/repositories/business-review-memo.repository.js";
import { BUSINESS_REVIEW_HUMAN_DECISIONS } from "../../domain/business-review-memo/business-review-memo.types.js";
import { businessReviewMemoService } from "../../services/business-review-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam, requireQueryParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const businessReviewMemosRouter = Router();

businessReviewMemosRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await businessReviewMemoService.getOrThrow(requireParam(req, "id")));
  }),
);

businessReviewMemosRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await businessReviewMemoRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

const decisionSchema = z.object({ humanDecision: z.enum(BUSINESS_REVIEW_HUMAN_DECISIONS), humanReason: z.string().nullable().optional() });

/** Human-Owner-only (docs/M8_ARCHITECTURE_PROPOSAL.md §25). */
businessReviewMemosRouter.post(
  "/:id/decision",
  requireHuman(),
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    const memo = await businessReviewMemoService.recordHumanDecision({
      memoId: requireParam(req, "id"),
      humanDecision: body.humanDecision,
      humanReason: body.humanReason ?? null,
      actor: toActor(getActor(req)),
    });
    res.json(memo);
  }),
);

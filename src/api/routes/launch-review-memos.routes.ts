import { Router } from "express";
import { z } from "zod";
import { LAUNCH_REVIEW_HUMAN_DECISIONS } from "../../domain/launch-review-memo/launch-review-memo.types.js";
import { calibrationService } from "../../services/calibration.service.js";
import { launchReviewMemoService } from "../../services/launch-review-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const launchReviewMemosRouter = Router();

/** Registered BEFORE /:id below so Express never shadows it as an :id value (mirrors product-review-memos.routes.ts's own precedent). */
launchReviewMemosRouter.get(
  "/calibration-summary",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    res.json(await calibrationService.summarizeLaunch());
  }),
);

launchReviewMemosRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await launchReviewMemoService.getOrThrow(requireParam(req, "id")));
  }),
);

const decideSchema = z.object({ humanDecision: z.enum(LAUNCH_REVIEW_HUMAN_DECISIONS), humanReason: z.string().nullable().optional() });

/** Human-Owner-only, exactly once (idempotent) — APPROVE/REQUEST_CHANGES/REJECT/DEFER (docs/M7_ARCHITECTURE_PROPOSAL.md §31). */
launchReviewMemosRouter.post(
  "/:id/decide",
  requireHuman(),
  validateBody(decideSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decideSchema>;
    const memo = await launchReviewMemoService.recordHumanDecision({
      memoId: requireParam(req, "id"),
      humanDecision: body.humanDecision,
      humanReason: body.humanReason ?? null,
      actor: toActor(getActor(req)),
    });
    res.json(memo);
  }),
);

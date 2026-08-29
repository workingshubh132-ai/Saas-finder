import { Router } from "express";
import { z } from "zod";
import { approvalService } from "../../services/approval.service.js";
import { decisionQueueService } from "../../services/decision-queue.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const decisionsRouter = Router();

decisionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await decisionQueueService.listQueue());
  }),
);

decisionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await decisionQueueService.getDecision(requireParam(req, "id")));
  }),
);

const reviewSchema = z.object({ reviewedBy: z.string().min(1), decisionReason: z.string().optional() });

decisionsRouter.post(
  "/:id/approve",
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.decide({ id: requireParam(req, "id"), toStatus: "APPROVED", ...body }));
  }),
);

decisionsRouter.post(
  "/:id/reject",
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.decide({ id: requireParam(req, "id"), toStatus: "REJECTED", ...body }));
  }),
);

decisionsRouter.post(
  "/:id/modify",
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.decide({ id: requireParam(req, "id"), toStatus: "MODIFIED", ...body }));
  }),
);

decisionsRouter.post(
  "/:id/defer",
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.decide({ id: requireParam(req, "id"), toStatus: "DEFERRED", ...body }));
  }),
);

decisionsRouter.post(
  "/:id/request-more-evidence",
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.requestMoreEvidence({ id: requireParam(req, "id"), ...body }));
  }),
);

decisionsRouter.post(
  "/:id/requeue",
  asyncHandler(async (req, res) => {
    res.json(await approvalService.requeue(requireParam(req, "id")));
  }),
);

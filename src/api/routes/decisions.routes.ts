import { Router } from "express";
import { z } from "zod";
import { approvalService } from "../../services/approval.service.js";
import { decisionQueueService } from "../../services/decision-queue.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const decisionsRouter = Router();

decisionsRouter.get(
  "/",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    res.json(await decisionQueueService.listQueue());
  }),
);

decisionsRouter.get(
  "/:id",
  requireHuman(),
  asyncHandler(async (req, res) => {
    res.json(await decisionQueueService.getDecision(requireParam(req, "id")));
  }),
);

const reviewSchema = z.object({ decisionReason: z.string().optional() });

decisionsRouter.post(
  "/:id/approve",
  requireHuman(),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(
      await approvalService.decide({ id: requireParam(req, "id"), toStatus: "APPROVED", ...body, reviewedBy: toActor(getActor(req)) }),
    );
  }),
);

decisionsRouter.post(
  "/:id/reject",
  requireHuman(),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(
      await approvalService.decide({ id: requireParam(req, "id"), toStatus: "REJECTED", ...body, reviewedBy: toActor(getActor(req)) }),
    );
  }),
);

decisionsRouter.post(
  "/:id/modify",
  requireHuman(),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(
      await approvalService.decide({ id: requireParam(req, "id"), toStatus: "MODIFIED", ...body, reviewedBy: toActor(getActor(req)) }),
    );
  }),
);

decisionsRouter.post(
  "/:id/defer",
  requireHuman(),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(
      await approvalService.decide({ id: requireParam(req, "id"), toStatus: "DEFERRED", ...body, reviewedBy: toActor(getActor(req)) }),
    );
  }),
);

decisionsRouter.post(
  "/:id/request-more-evidence",
  requireHuman(),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reviewSchema>;
    res.json(await approvalService.requestMoreEvidence({ id: requireParam(req, "id"), ...body, reviewedBy: toActor(getActor(req)) }));
  }),
);

decisionsRouter.post(
  "/:id/requeue",
  requireHuman(),
  asyncHandler(async (req, res) => {
    res.json(await approvalService.requeue(requireParam(req, "id")));
  }),
);

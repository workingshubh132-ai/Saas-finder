import { Router } from "express";
import { researchQueueRepository } from "../../db/repositories/research-queue.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const researchQueueRouter = Router();

/** The prioritized research queue, highest priority first (M3 brief Part 30). */
researchQueueRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await researchQueueRepository.list({ status }));
  }),
);

researchQueueRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const item = await researchQueueRepository.findById(requireParam(req, "id"));
    if (!item) throw new NotFoundError("ResearchQueueItem", requireParam(req, "id"));
    res.json(item);
  }),
);

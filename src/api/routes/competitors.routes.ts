import { Router } from "express";
import { competitorRepository } from "../../db/repositories/competitor.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";

export const competitorsRouter = Router();

/** The canonical competitor roster, reusable across opportunities/problems (M3 brief Part 17). */
competitorsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await competitorRepository.list());
  }),
);

import { Router } from "express";
import { competitorRepository } from "../../db/repositories/competitor.repository.js";
import { problemService } from "../../services/problem.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const problemsRouter = Router();

problemsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await problemService.list({ status }));
  }),
);

problemsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await problemService.getOrThrow(requireParam(req, "id")));
  }),
);

/** Competitor findings for this problem (M3 brief Part 17). */
problemsRouter.get(
  "/:id/competitor-observations",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await competitorRepository.listObservationsForProblem(requireParam(req, "id")));
  }),
);

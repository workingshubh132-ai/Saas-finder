import { Router } from "express";
import { z } from "zod";
import { portfolioSnapshotRepository } from "../../db/repositories/portfolio-snapshot.repository.js";
import { controlPlaneService } from "../../services/control-plane.service.js";
import { portfolioService } from "../../services/portfolio.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireQueryParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const portfolioRouter = Router();

/** The Portfolio Control view (docs/M9_ARCHITECTURE_PROPOSAL.md §22) — every LIVE/PAUSED product bucketed by business health, reusing portfolioAnalystService's own reads. */
portfolioRouter.get(
  "/overview",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await controlPlaneService.getPortfolio());
  }),
);

portfolioRouter.get(
  "/snapshots",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await portfolioSnapshotRepository.listForRun(requireQueryParam(req, "runId")));
  }),
);

const analyzePortfolioSchema = z.object({
  agentId: z.string().min(1),
  ceoAgentId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1),
});

/**
 * Cross-product comparison over Constitution §19's own vocabulary
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §28) — a RETIRE/PIVOT
 * recommendation never itself changes anything; it triggers the same
 * CEO -> Chairman -> BusinessReviewMemo pipeline every other business
 * recommendation goes through.
 */
portfolioRouter.post(
  "/analyze",
  requireAuth(),
  validateBody(analyzePortfolioSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof analyzePortfolioSchema>;
    const summary = await portfolioService.analyzePortfolio({ ...body, startedBy: getActor(req) });
    res.status(201).json(summary);
  }),
);

import { Router } from "express";
import { decisionQualityService } from "../../services/decision-quality.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";

export const decisionQualityRouter = Router();

/** The Decision Quality Dashboard (docs/M9_ARCHITECTURE_PROPOSAL.md §29) — five existing calibration summaries plus prediction accuracy by source. */
decisionQualityRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await decisionQualityService.getDashboard());
  }),
);

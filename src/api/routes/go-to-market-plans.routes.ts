import { Router } from "express";
import { goToMarketPlanRepository } from "../../db/repositories/go-to-market-plan.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const goToMarketPlansRouter = Router();

goToMarketPlansRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await goToMarketPlanRepository.findById(requireParam(req, "id")));
  }),
);

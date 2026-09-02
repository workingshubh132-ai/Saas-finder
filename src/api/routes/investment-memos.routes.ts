import { Router } from "express";
import { investmentMemoService } from "../../services/investment-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const investmentMemosRouter = Router();

investmentMemosRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await investmentMemoService.getOrThrow(requireParam(req, "id")));
  }),
);

import { Router } from "express";
import { cohortRepository } from "../../db/repositories/cohort.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireQueryParam } from "../middleware/params.js";

export const cohortsRouter = Router();

cohortsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await cohortRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

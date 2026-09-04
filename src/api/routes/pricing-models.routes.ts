import { Router } from "express";
import { pricingModelRepository } from "../../db/repositories/pricing-model.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const pricingModelsRouter = Router();

pricingModelsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await pricingModelRepository.findById(requireParam(req, "id")));
  }),
);

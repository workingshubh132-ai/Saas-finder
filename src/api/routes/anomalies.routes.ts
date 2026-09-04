import { Router } from "express";
import { anomalyRepository } from "../../db/repositories/anomaly.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireQueryParam } from "../middleware/params.js";

export const anomaliesRouter = Router();

anomaliesRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await anomalyRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

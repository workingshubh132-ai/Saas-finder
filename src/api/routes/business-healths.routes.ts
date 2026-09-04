import { Router } from "express";
import { businessHealthRepository } from "../../db/repositories/business-health.repository.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireQueryParam } from "../middleware/params.js";

export const businessHealthsRouter = Router();

/** Every dimension preserved alongside the composite score — never reduced to one magical number (docs/M8_ARCHITECTURE_PROPOSAL.md §18-19). */
businessHealthsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await businessHealthRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

businessHealthsRouter.get(
  "/latest",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await businessHealthRepository.findLatestForProduct(requireQueryParam(req, "productId")));
  }),
);

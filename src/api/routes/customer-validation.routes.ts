import { Router } from "express";
import { customerValidationService } from "../../services/customer-validation.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const customerValidationRouter = Router();

/** The Phase 12 deterministic opportunity summary — read-only, no model call (docs/CUSTOMER_DISCOVERY_VALIDATION.md). */
customerValidationRouter.get(
  "/:opportunityId",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await customerValidationService.summarize(requireParam(req, "opportunityId")));
  }),
);

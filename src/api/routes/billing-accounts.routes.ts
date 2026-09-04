import { Router } from "express";
import { z } from "zod";
import { billingAccountRepository } from "../../db/repositories/billing-account.repository.js";
import { billingActivationService } from "../../services/billing-activation.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth, requireHuman } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const billingAccountsRouter = Router();

billingAccountsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await billingAccountRepository.findById(requireParam(req, "id")));
  }),
);

const subscriptionFixtureSchema = z.object({ customerEmail: z.string().min(1) });

/**
 * Test/demo-only (docs/M7_ARCHITECTURE_PROPOSAL.md §19, §40.4) —
 * never invoked by any agent; creates a fixture subscription against
 * the DEV_FIXTURE provider only. Human-Owner-only so it can never be
 * confused with a real production capability.
 */
billingAccountsRouter.post(
  "/:id/subscription-fixture",
  requireHuman(),
  validateBody(subscriptionFixtureSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof subscriptionFixtureSchema>;
    const result = await billingActivationService.recordSubscriptionFixture({ billingAccountId: requireParam(req, "id"), customerEmail: body.customerEmail });
    res.status(201).json(result);
  }),
);

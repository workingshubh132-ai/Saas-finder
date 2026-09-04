import { Router } from "express";
import { z } from "zod";
import { predictionOutcomeRepository } from "../../db/repositories/prediction-outcome.repository.js";
import { BUSINESS_METRIC_TYPES } from "../../domain/business-metric/business-metric.types.js";
import { predictionOutcomeService } from "../../services/prediction-outcome.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam, requireQueryParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const predictionOutcomesRouter = Router();

predictionOutcomesRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await predictionOutcomeRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

const recordSchema = z.object({
  productId: z.string().min(1),
  metricType: z.enum(BUSINESS_METRIC_TYPES),
  predictedValue: z.number(),
  targetPeriodStart: z.coerce.date(),
  targetPeriodEnd: z.coerce.date(),
  predictionSource: z.string().min(1),
});

/** Recorded before outcomes are known (Constitution §23; docs/M8_ARCHITECTURE_PROPOSAL.md §38). */
predictionOutcomesRouter.post(
  "/",
  requireAuth(),
  validateBody(recordSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordSchema>;
    res.status(201).json(await predictionOutcomeService.record(body));
  }),
);

const resolveSchema = z.object({ observedValue: z.number() });

/** Only once the target period has actually elapsed — no future-information leakage (docs/M8_ARCHITECTURE_PROPOSAL.md §38). */
predictionOutcomesRouter.post(
  "/:id/resolve",
  requireAuth(),
  validateBody(resolveSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof resolveSchema>;
    const result = await predictionOutcomeService.resolve({ predictionOutcomeId: requireParam(req, "id"), observedValue: body.observedValue });
    res.status(201).json(result);
  }),
);

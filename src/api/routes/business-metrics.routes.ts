import { Router } from "express";
import { z } from "zod";
import { businessMetricRepository } from "../../db/repositories/business-metric.repository.js";
import { BUSINESS_METRIC_SOURCES, BUSINESS_METRIC_TYPES, BUSINESS_METRIC_VALUE_KINDS } from "../../domain/business-metric/business-metric.types.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireQueryParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const businessMetricsRouter = Router();

/** Every read groups/labels by valueKind (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §23) — never a blended aggregate. */
businessMetricsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await businessMetricRepository.listForProduct(requireQueryParam(req, "productId")));
  }),
);

const recordMetricSchema = z.object({
  productId: z.string().min(1),
  metricType: z.enum(BUSINESS_METRIC_TYPES),
  valueKind: z.enum(BUSINESS_METRIC_VALUE_KINDS),
  value: z.number(),
  source: z.enum(BUSINESS_METRIC_SOURCES),
});

/** Manual entry — a human recording a real observed or estimated business fact (docs/M7_ARCHITECTURE_PROPOSAL.md §23). */
businessMetricsRouter.post(
  "/",
  requireAuth(),
  validateBody(recordMetricSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordMetricSchema>;
    res.status(201).json(await businessMetricRepository.create(body));
  }),
);

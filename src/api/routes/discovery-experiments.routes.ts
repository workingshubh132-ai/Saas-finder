import { Router } from "express";
import { z } from "zod";
import { discoveryExperimentService } from "../../services/discovery-experiment.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";

export const discoveryExperimentsRouter = Router();

const runDiscoveryExperimentSchema = z.object({
  opportunityId: z.string().min(1),
  experimentId: z.string().min(1),
  targetCount: z.number().int().min(1).max(25),
});

/**
 * Research -> business discovery -> qualification -> contact discovery
 * -> outreach draft -> human approval, in one call
 * (docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md). Never sends anything —
 * messagesSent is always 0 in the response.
 */
discoveryExperimentsRouter.post(
  "/run",
  requireAuth(),
  validateBody(runDiscoveryExperimentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runDiscoveryExperimentSchema>;
    const report = await discoveryExperimentService.run(body);
    res.status(201).json(report);
  }),
);

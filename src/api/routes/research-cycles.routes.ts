import { Router } from "express";
import { z } from "zod";
import { researchCycleRepository } from "../../db/repositories/research-cycle.repository.js";
import { researchCycleService } from "../../services/research-cycle.service.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const researchCyclesRouter = Router();

const runCycleSchema = z.object({
  objective: z.string().min(1).max(2000),
  researchAgentId: z.string().min(1),
  problemAnalystAgentId: z.string().min(1),
  competitorAnalystAgentId: z.string().min(1),
  marketAnalystAgentId: z.string().min(1),
  opportunityAnalystAgentId: z.string().min(1),
  budgetOverrides: z
    .object({
      maxDurationMs: z.number().int().positive().optional(),
      maxSignals: z.number().int().positive().optional(),
      maxToolCalls: z.number().int().positive().optional(),
      maxModelCalls: z.number().int().positive().optional(),
      maxCostUsd: z.number().min(0).optional(),
    })
    .optional(),
});

/**
 * The CEO orchestration boundary, over HTTP (M3 brief Part 26, 28-29):
 * runs one bounded research cycle end to end. Human-Owner-only to
 * start, same "Human -> CEO Task -> Research Agent" precedent as
 * POST /api/research (docs/M3_ARCHITECTURE_PROPOSAL.md §14).
 */
researchCyclesRouter.post(
  "/",
  requireHuman(),
  validateBody(runCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runCycleSchema>;
    const summary = await researchCycleService.run({ ...body, startedBy: getActor(req) });
    res.status(201).json(summary);
  }),
);

researchCyclesRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await researchCycleRepository.list({ status }));
  }),
);

researchCyclesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const cycle = await researchCycleRepository.findById(requireParam(req, "id"));
    if (!cycle) throw new NotFoundError("ResearchCycle", requireParam(req, "id"));
    res.json(cycle);
  }),
);

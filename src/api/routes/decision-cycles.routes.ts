import { Router } from "express";
import { z } from "zod";
import { decisionCycleRepository } from "../../db/repositories/decision-cycle.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { decisionCycleService } from "../../services/decision-cycle.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const decisionCyclesRouter = Router();

const runDecisionCycleSchema = z.object({
  opportunityId: z.string().min(1),
  evidenceValidatorAgentId: z.string().min(1),
  ceoAgentId: z.string().min(1),
  budgetOverrides: z
    .object({
      maxClaims: z.number().int().positive().optional(),
      maxValidatorSearches: z.number().int().min(0).optional(),
      maxModelCalls: z.number().int().positive().optional(),
      maxResearchTasks: z.number().int().min(0).optional(),
      maxCeoPlanningSteps: z.number().int().positive().optional(),
      maxDurationMs: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * The CEO-pipeline orchestration boundary, over HTTP
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §16, §22) — runs one bounded
 * decision cycle end to end for an existing opportunity. Human-Owner-only
 * to start, same precedent as POST /api/research-cycles.
 */
decisionCyclesRouter.post(
  "/",
  requireHuman(),
  validateBody(runDecisionCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runDecisionCycleSchema>;
    const summary = await decisionCycleService.run({ ...body, startedBy: getActor(req) });
    res.status(201).json(summary);
  }),
);

decisionCyclesRouter.get(
  "/:id",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const cycle = await decisionCycleRepository.findById(requireParam(req, "id"));
    if (!cycle) throw new NotFoundError("DecisionCycle", requireParam(req, "id"));
    res.json(cycle);
  }),
);

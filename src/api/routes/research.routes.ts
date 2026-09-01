import { Router } from "express";
import { z } from "zod";
import { researchAgentService } from "../../services/research-agent.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";

export const researchRouter = Router();

const runResearchSchema = z.object({
  agentId: z.string().min(1),
  objective: z.string().min(1).max(2000),
  taskId: z.string().nullable().optional(),
});

/**
 * The real, agent-executed signal-collection run (M2 brief Parts
 * 10-13; M3 brief Part 1 — collection only, see
 * docs/M3_ARCHITECTURE_PROPOSAL.md §1/§9 for why synthesis moved
 * downstream) — distinct from POST /api/research-signals (M1's
 * manual/direct intake for already-structured signals, kept as-is for
 * that use). Human-Owner-only to start: the Constitution's "Human ->
 * CEO Task -> Research Agent" chain begins with a human.
 */
researchRouter.post(
  "/",
  requireHuman(),
  validateBody(runResearchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runResearchSchema>;
    const outcome = await researchAgentService.run({ ...body, startedBy: getActor(req) });
    res.status(201).json(outcome);
  }),
);

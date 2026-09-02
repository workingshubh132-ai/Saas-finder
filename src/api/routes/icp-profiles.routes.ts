import { Router } from "express";
import { z } from "zod";
import { icpProfileRepository } from "../../db/repositories/icp-profile.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { icpAnalystService } from "../../services/icp-analyst.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const icpProfilesRouter = Router();

icpProfilesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const profile = await icpProfileRepository.findById(requireParam(req, "id"));
    if (!profile) throw new NotFoundError("IcpProfile", requireParam(req, "id"));
    res.json(profile);
  }),
);

const runIcpAnalystSchema = z.object({ agentId: z.string().min(1), opportunityId: z.string().min(1) });

/**
 * Runs the ICP Analyst for one opportunity (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §3) — historized: every call creates a new IcpProfile row, never
 * overwrites an earlier targeting decision.
 */
icpProfilesRouter.post(
  "/",
  requireAuth(),
  validateBody(runIcpAnalystSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runIcpAnalystSchema>;
    const outcome = await icpAnalystService.run({ ...body, startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "ICP Analyst execution did not complete.", execution: outcome.execution });
      return;
    }
    res.status(201).json(outcome.result);
  }),
);

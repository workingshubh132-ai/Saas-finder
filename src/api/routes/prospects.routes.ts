import { Router } from "express";
import { z } from "zod";
import { prospectService } from "../../services/prospect.service.js";
import { prospectQualificationService } from "../../services/prospect-qualification.service.js";
import { prospectResearcherService } from "../../services/prospect-researcher.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const prospectsRouter = Router();

prospectsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await prospectService.getOrThrow(requireParam(req, "id")));
  }),
);

const runProspectResearcherSchema = z.object({ agentId: z.string().min(1), icpProfileId: z.string().min(1) });

/** Finds candidates matching an approved ICP (docs/M5_ARCHITECTURE_PROPOSAL.md §6-7) — every prospect carries real, verified source provenance. */
prospectsRouter.post(
  "/",
  requireAuth(),
  validateBody(runProspectResearcherSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runProspectResearcherSchema>;
    const outcome = await prospectResearcherService.run({ ...body, startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Prospect Researcher execution did not complete.", execution: outcome.execution });
      return;
    }
    res.status(201).json(outcome.result);
  }),
);

const runQualificationSchema = z.object({ agentId: z.string().min(1) });

/** Never a bare score (docs/M5_ARCHITECTURE_PROPOSAL.md §5) — qualificationStatus + icpFit + reasonForMatch + unknowns. */
prospectsRouter.post(
  "/:id/qualify",
  requireAuth(),
  validateBody(runQualificationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runQualificationSchema>;
    const outcome = await prospectQualificationService.run({ agentId: body.agentId, prospectId: requireParam(req, "id"), startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Prospect Qualification execution did not complete.", execution: outcome.execution });
      return;
    }
    res.status(200).json(outcome.result);
  }),
);

const doNotContactSchema = z.object({ reason: z.string().min(1) });

/** Human-Owner-only — the one, explicitly-named way to pull a prospect out of the pipeline at any point (docs/M5_ARCHITECTURE_PROPOSAL.md §8). */
prospectsRouter.post(
  "/:id/do-not-contact",
  requireHuman(),
  validateBody(doNotContactSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof doNotContactSchema>;
    const actor = toActor(getActor(req));
    const prospect = await prospectService.markDoNotContact({ id: requireParam(req, "id"), reason: body.reason, actorType: actor.actorType, actorId: actor.actorId });
    res.json(prospect);
  }),
);

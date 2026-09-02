import { Router } from "express";
import { z } from "zod";
import { outreachMessageRepository } from "../../db/repositories/outreach-message.repository.js";
import { outreachExperimentService } from "../../services/outreach-experiment.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const outreachExperimentsRouter = Router();

outreachExperimentsRouter.get(
  "/:id",
  requireHuman(),
  asyncHandler(async (req, res) => {
    res.json(await outreachExperimentService.getOrThrow(requireParam(req, "id")));
  }),
);

outreachExperimentsRouter.get(
  "/:id/messages",
  requireHuman(),
  asyncHandler(async (req, res) => {
    res.json(await outreachMessageRepository.listForExperiment(requireParam(req, "id")));
  }),
);

const createExperimentSchema = z.object({
  opportunityId: z.string().min(1),
  objective: z.string().min(1),
  claimId: z.string().min(1),
  targetIcpProfileId: z.string().min(1),
  researchQuestion: z.string().min(1),
  messageStrategy: z.string().min(1),
  prospectLimit: z.number().int().positive(),
  timeWindowStart: z.string().datetime().nullable().optional(),
  timeWindowEnd: z.string().datetime().nullable().optional(),
  successCriteria: z.string().min(1),
  failureCriteria: z.string().min(1),
  contactPolicy: z.string().optional(),
  createdByIdentityId: z.string().min(1),
});

/**
 * Every privileged action here is Human-Owner-only (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §23-24) — an experiment is where real, named prospects start being
 * considered for drafting, the point the M5 core loop's own privacy/
 * consent boundary begins to matter, even before the first hard gate
 * (approve, below) opens it for actual drafting.
 */
outreachExperimentsRouter.post(
  "/",
  requireHuman(),
  validateBody(createExperimentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createExperimentSchema>;
    const experiment = await outreachExperimentService.create({
      ...body,
      timeWindowStart: body.timeWindowStart ? new Date(body.timeWindowStart) : null,
      timeWindowEnd: body.timeWindowEnd ? new Date(body.timeWindowEnd) : null,
    });
    res.status(201).json(experiment);
  }),
);

/** The first hard human gate (docs/M5_ARCHITECTURE_PROPOSAL.md §2, §11): PENDING_APPROVAL -> ACTIVE. No message may be drafted before this. */
outreachExperimentsRouter.post(
  "/:id/approve",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const experiment = await outreachExperimentService.approve({ id: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.json(experiment);
  }),
);

const setStatusSchema = z.object({ toStatus: z.string(), reason: z.string().nullable().optional() });

outreachExperimentsRouter.post(
  "/:id/status",
  requireHuman(),
  validateBody(setStatusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setStatusSchema>;
    const actor = toActor(getActor(req));
    const experiment = await outreachExperimentService.setStatus({
      id: requireParam(req, "id"),
      toStatus: body.toStatus,
      reason: body.reason ?? null,
      actorType: actor.actorType,
      actorId: actor.actorId,
    });
    res.json(experiment);
  }),
);

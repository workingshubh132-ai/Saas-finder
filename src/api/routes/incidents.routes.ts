import { Router } from "express";
import { z } from "zod";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "../../domain/incident/incident.types.js";
import { incidentService } from "../../services/incident.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const incidentsRouter = Router();

incidentsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await incidentService.getOrThrow(requireParam(req, "id")));
  }),
);

const createIncidentSchema = z.object({ productId: z.string().min(1), deploymentId: z.string().nullable().optional(), severity: z.enum(INCIDENT_SEVERITIES), summary: z.string().min(1) });

/** Created by a human directly or by a failed health check surfaced through the API (docs/M7_ARCHITECTURE_PROPOSAL.md §26). */
incidentsRouter.post(
  "/",
  requireAuth(),
  validateBody(createIncidentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createIncidentSchema>;
    const incident = await incidentService.create({ ...body, deploymentId: body.deploymentId ?? null, actor: toActor(getActor(req)) });
    res.status(201).json(incident);
  }),
);

const setStatusSchema = z.object({ status: z.enum(INCIDENT_STATUSES), postmortem: z.string().nullable().optional() });

incidentsRouter.post(
  "/:id/status",
  requireAuth(),
  validateBody(setStatusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setStatusSchema>;
    const incident = await incidentService.setStatus(requireParam(req, "id"), body.status, toActor(getActor(req)), body.postmortem ? { postmortem: body.postmortem } : {});
    res.json(incident);
  }),
);

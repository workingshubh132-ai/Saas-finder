import { Router } from "express";
import { z } from "zod";
import { opportunityService } from "../../services/opportunity.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const opportunitiesRouter = Router();

const actorSchema = z.object({
  actorType: z.enum(["AGENT", "HUMAN", "SYSTEM"]),
  actorId: z.string().min(1),
});

const createOpportunitySchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  targetCustomer: z.string().min(1),
  description: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  discoveredBy: actorSchema,
});

opportunitiesRouter.post(
  "/",
  validateBody(createOpportunitySchema),
  asyncHandler(async (req, res) => {
    const opportunity = await opportunityService.createOpportunity(req.body as z.infer<typeof createOpportunitySchema>);
    res.status(201).json(opportunity);
  }),
);

opportunitiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await opportunityService.listOpportunities({ status }));
  }),
);

opportunitiesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.getOrThrow(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/evidence",
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.listEvidence(requireParam(req, "id")));
  }),
);

const attachEvidenceSchema = z.object({ evidenceId: z.string().min(1), actor: actorSchema });

opportunitiesRouter.post(
  "/:id/evidence",
  validateBody(attachEvidenceSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof attachEvidenceSchema>;
    const evidence = await opportunityService.attachEvidence({ opportunityId: requireParam(req, "id"), ...body });
    res.status(201).json(evidence);
  }),
);

const dimensionsSchema = z.object({
  pain: z.number().min(0).max(1),
  demand: z.number().min(0).max(1),
  willingnessToPay: z.number().min(0).max(1),
  reachability: z.number().min(0).max(1),
  retention: z.number().min(0).max(1),
  differentiation: z.number().min(0).max(1),
  buildability: z.number().min(0).max(1),
  economics: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
  evidenceQuality: z.number().min(0).max(1),
});

const scoreOpportunitySchema = z.object({ dimensions: dimensionsSchema, scoredBy: z.string().min(1) });

opportunitiesRouter.post(
  "/:id/score",
  validateBody(scoreOpportunitySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof scoreOpportunitySchema>;
    const opportunity = await opportunityService.scoreOpportunity({ opportunityId: requireParam(req, "id"), ...body });
    res.json(opportunity);
  }),
);

opportunitiesRouter.get(
  "/:id/scores",
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.listScoreHistory(requireParam(req, "id")));
  }),
);

const transitionSchema = z.object({ toStatus: z.string(), actor: actorSchema });

opportunitiesRouter.post(
  "/:id/status",
  validateBody(transitionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionSchema>;
    const opportunity = await opportunityService.transition({ id: requireParam(req, "id"), ...body });
    res.json(opportunity);
  }),
);

const validationLevelSchema = z.object({ validationLevel: z.string(), actor: actorSchema });

opportunitiesRouter.post(
  "/:id/validation-level",
  validateBody(validationLevelSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof validationLevelSchema>;
    const opportunity = await opportunityService.setValidationLevel({ id: requireParam(req, "id"), ...body });
    res.json(opportunity);
  }),
);

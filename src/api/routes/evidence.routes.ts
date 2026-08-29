import { Router } from "express";
import { z } from "zod";
import { evidenceService } from "../../services/evidence.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const evidenceRouter = Router();

const actorSchema = z.object({
  actorType: z.enum(["AGENT", "HUMAN", "SYSTEM"]),
  actorId: z.string().min(1),
});

const collectEvidenceSchema = z.object({
  claim: z.string().min(1),
  source: z.string().min(1),
  sourceType: z.string(),
  sourceReference: z.string().nullable().optional(),
  collectedByAgentId: z.string().min(1),
  reliability: z.string(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

evidenceRouter.post(
  "/",
  validateBody(collectEvidenceSchema),
  asyncHandler(async (req, res) => {
    const evidence = await evidenceService.collectEvidence(req.body as z.infer<typeof collectEvidenceSchema>);
    res.status(201).json(evidence);
  }),
);

evidenceRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await evidenceService.listEvidence());
  }),
);

evidenceRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await evidenceService.getOrThrow(requireParam(req, "id")));
  }),
);

const setVerificationSchema = z.object({ verificationStatus: z.string(), actor: actorSchema });

evidenceRouter.post(
  "/:id/verification",
  validateBody(setVerificationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setVerificationSchema>;
    const evidence = await evidenceService.setVerificationStatus({ id: requireParam(req, "id"), ...body });
    res.json(evidence);
  }),
);

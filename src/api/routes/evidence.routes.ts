import { Router } from "express";
import { z } from "zod";
import { AuthorizationDeniedError } from "../../domain/shared/errors.js";
import { evidenceService } from "../../services/evidence.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const evidenceRouter = Router();

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
  requireAuth(),
  validateBody(collectEvidenceSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof collectEvidenceSchema>;
    const actor = getActor(req);
    // An AGENT identity may only attribute evidence to itself — never
    // claim to have collected it via a different agent. HUMAN/SYSTEM
    // callers may attribute evidence to any existing agent (e.g. manual
    // entry recorded on an agent's behalf).
    if (actor.type === "AGENT" && body.collectedByAgentId !== actor.id) {
      throw new AuthorizationDeniedError("An AGENT identity can only collect evidence attributed to itself.");
    }
    const evidence = await evidenceService.collectEvidence(body);
    res.status(201).json(evidence);
  }),
);

evidenceRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await evidenceService.listEvidence());
  }),
);

evidenceRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await evidenceService.getOrThrow(requireParam(req, "id")));
  }),
);

const setVerificationSchema = z.object({ verificationStatus: z.string() });

evidenceRouter.post(
  "/:id/verification",
  requireAuth(),
  validateBody(setVerificationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setVerificationSchema>;
    const evidence = await evidenceService.setVerificationStatus({
      id: requireParam(req, "id"),
      ...body,
      actor: toActor(getActor(req)),
    });
    res.json(evidence);
  }),
);

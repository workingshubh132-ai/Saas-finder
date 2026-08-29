import { Router } from "express";
import { z } from "zod";
import { AuthorizationDeniedError } from "../../domain/shared/errors.js";
import { researchIntakeService } from "../../services/research-intake.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";

export const researchSignalsRouter = Router();

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

const researchSignalSchema = z.object({
  agentId: z.string().min(1),
  opportunity: z.object({
    title: z.string().min(1),
    problem: z.string().min(1),
    targetCustomer: z.string().min(1),
    description: z.string().min(1),
  }),
  evidence: z.array(
    z.object({
      claim: z.string().min(1),
      source: z.string().min(1),
      sourceType: z.string(),
      sourceReference: z.string().optional(),
      reliability: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  scoreDimensions: dimensionsSchema,
  approvalRequest: z.object({
    action: z.string(),
    description: z.string().min(1),
    riskLevel: z.string(),
    reason: z.string().optional(),
  }),
});

/**
 * The vertical-slice demo endpoint (M1 brief §17): research signal ->
 * opportunity -> evidence -> score -> approval request, in one call.
 * See src/services/research-intake.service.ts — this route adds no
 * logic of its own, only request validation.
 */
researchSignalsRouter.post(
  "/",
  requireAuth(),
  validateBody(researchSignalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof researchSignalSchema>;
    const actor = getActor(req);
    // Same rule as evidence collection: an AGENT identity can only run
    // a research signal as itself, never impersonate a different agent.
    if (actor.type === "AGENT" && body.agentId !== actor.id) {
      throw new AuthorizationDeniedError("An AGENT identity can only submit a research signal attributed to itself.");
    }
    const result = await researchIntakeService.intake(body);
    res.status(201).json(result);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { customerDiscoveryInteractionService } from "../../services/customer-discovery-interaction.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const customerDiscoveryInteractionsRouter = Router();

const recordInteractionSchema = z.object({
  opportunityId: z.string().min(1),
  prospectId: z.string().min(1),
  outreachMessageId: z.string().min(1).nullable().optional(),
  interactionType: z.string().min(1),
  interactionDate: z.string().datetime(),
  channel: z.string().min(1).nullable().optional(),
  participantRole: z.string().min(1).nullable().optional(),
  rawNotes: z.string().min(1),
  reality: z.string().min(1),
  provenanceNote: z.string(),
});

/** Human-only — manually transcribed from a real external channel VentureForge has no programmatic access to (docs/CUSTOMER_DISCOVERY_VALIDATION.md). */
customerDiscoveryInteractionsRouter.post(
  "/",
  requireHuman(),
  validateBody(recordInteractionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordInteractionSchema>;
    const interaction = await customerDiscoveryInteractionService.record({
      ...body,
      interactionDate: new Date(body.interactionDate),
      actor: toActor(getActor(req)),
    });
    res.status(201).json(interaction);
  }),
);

customerDiscoveryInteractionsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await customerDiscoveryInteractionService.getOrThrow(requireParam(req, "id")));
  }),
);

const attachFindingSchema = z.object({
  field: z.string().min(1),
  provenance: z.string().min(1),
  value: z.string().min(1),
  evidenceQuote: z.string().min(1).nullable().optional(),
  strength: z.string().min(1).optional(),
  agentId: z.string().min(1),
});

/** Never lets an INFERRED/UNKNOWN finding become Evidence — see attachFinding's own doc comment. */
customerDiscoveryInteractionsRouter.post(
  "/:id/findings",
  requireAuth(),
  validateBody(attachFindingSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof attachFindingSchema>;
    const result = await customerDiscoveryInteractionService.attachFinding({ ...body, interactionId: requireParam(req, "id") });
    res.status(201).json(result);
  }),
);

const setOutcomeSchema = z.object({ outcome: z.string().min(1) });

/** Human-only — the deterministic validation engine's one disqualification signal. */
customerDiscoveryInteractionsRouter.post(
  "/:id/outcome",
  requireHuman(),
  validateBody(setOutcomeSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setOutcomeSchema>;
    const interaction = await customerDiscoveryInteractionService.setOutcome({
      interactionId: requireParam(req, "id"),
      outcome: body.outcome,
      actor: toActor(getActor(req)),
    });
    res.json(interaction);
  }),
);

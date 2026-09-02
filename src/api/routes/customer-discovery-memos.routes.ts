import { Router } from "express";
import { z } from "zod";
import { CUSTOMER_DISCOVERY_HUMAN_DECISIONS } from "../../domain/customer-discovery-memo/customer-discovery-memo.types.js";
import { calibrationService } from "../../services/calibration.service.js";
import { customerDiscoveryMemoService } from "../../services/customer-discovery-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const customerDiscoveryMemosRouter = Router();

/**
 * Registered BEFORE the /:id route below: Express would otherwise
 * match "calibration-summary" as an :id parameter value, silently
 * shadowing this route (matches decision-records.routes.ts's own
 * precedent, docs/M4_ARCHITECTURE_PROPOSAL.md §28, §39).
 */
customerDiscoveryMemosRouter.get(
  "/calibration-summary",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    res.json(await calibrationService.summarizeCustomerDiscovery());
  }),
);

customerDiscoveryMemosRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await customerDiscoveryMemoService.getOrThrow(requireParam(req, "id")));
  }),
);

const compileMemoSchema = z.object({
  experimentId: z.string().min(1),
  ceoRecommendationId: z.string().min(1),
  chairmanReviewId: z.string().min(1),
});

/** Compiled with ZERO new model calls (docs/M5_ARCHITECTURE_PROPOSAL.md §22, brief §29) — every field pulled from already-persisted data. */
customerDiscoveryMemosRouter.post(
  "/",
  requireAuth(),
  validateBody(compileMemoSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof compileMemoSchema>;
    const actor = getActor(req);
    const result = await customerDiscoveryMemoService.compile({ ...body, actorType: actor.type, actorId: actor.id });
    res.status(201).json(result);
  }),
);

const decideSchema = z.object({ decision: z.enum(CUSTOMER_DISCOVERY_HUMAN_DECISIONS), reason: z.string().nullable().optional() });

/** Human-Owner-only, exactly once (idempotent) — APPROVE/REJECT/MORE_RESEARCH/REFINE_ICP/STOP (brief §30). */
customerDiscoveryMemosRouter.post(
  "/:id/decide",
  requireHuman(),
  validateBody(decideSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decideSchema>;
    const memo = await customerDiscoveryMemoService.recordHumanDecision({
      memoId: requireParam(req, "id"),
      decision: body.decision,
      reason: body.reason ?? null,
      actor: toActor(getActor(req)),
    });
    res.json(memo);
  }),
);

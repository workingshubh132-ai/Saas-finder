import { Router } from "express";
import { z } from "zod";
import { claimRepository } from "../../db/repositories/claim.repository.js";
import { validationReportRepository } from "../../db/repositories/validation-report.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { claimConfidenceService } from "../../services/claim-confidence.service.js";
import { evidenceGapService } from "../../services/evidence-gap.service.js";
import { evidenceValidatorService } from "../../services/evidence-validator.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const claimsRouter = Router();

claimsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const claim = await claimRepository.findById(requireParam(req, "id"));
    if (!claim) throw new NotFoundError("Claim", requireParam(req, "id"));
    res.json(claim);
  }),
);

claimsRouter.get(
  "/:id/validation-reports",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await validationReportRepository.listForClaim(requireParam(req, "id")));
  }),
);

const validateClaimSchema = z.object({
  agentId: z.string().min(1),
  maxSearches: z.number().int().min(0).max(5).optional().default(0),
});

/**
 * Runs the Evidence Validator for one claim, then the deterministic
 * confidence recalculation and evidence-gap refresh that follow it
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §2, §11, §15) — the same chain
 * `decisionCycleService` runs internally per claim, exposed directly
 * for a caller validating one claim outside a full decision cycle.
 */
claimsRouter.post(
  "/:id/validate",
  requireAuth(),
  validateBody(validateClaimSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof validateClaimSchema>;
    const claimId = requireParam(req, "id");
    const actor = getActor(req);

    const outcome = await evidenceValidatorService.run({ agentId: body.agentId, claimId, maxSearches: body.maxSearches, startedBy: actor });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Evidence Validator execution did not complete.", execution: outcome.execution });
      return;
    }

    const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({ claimId, actorType: actor.type, actorId: actor.id });
    await evidenceGapService.analyzeClaim({ claim: updatedClaim, recommendedResearch: null });

    res.status(201).json({ claim: updatedClaim, validationReportId: outcome.result.validationReportId });
  }),
);

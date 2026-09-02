import { Router } from "express";
import { z } from "zod";
import { ceoRecommendationRepository } from "../../db/repositories/ceo-recommendation.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { decisionRecordService } from "../../services/decision-record.service.js";
import { investmentMemoService } from "../../services/investment-memo.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const ceoRecommendationsRouter = Router();

ceoRecommendationsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const recommendation = await ceoRecommendationRepository.findById(requireParam(req, "id"));
    if (!recommendation) throw new NotFoundError("CeoRecommendation", requireParam(req, "id"));
    res.json(recommendation);
  }),
);

const requestApprovalSchema = z.object({ requestedByAgentId: z.string().min(1) });

/**
 * KILL/PREPARE_REVIEW/HUMAN_REVIEW create an ApprovalRequest;
 * DEPRIORITIZE/INVESTIGATE/VALIDATE_CUSTOMER return null — the CEO
 * recommendation is never auto-applied either way
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §13, §20).
 */
ceoRecommendationsRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const approvalRequest = await decisionRecordService.requestApprovalForRecommendation({
      ceoRecommendationId: requireParam(req, "id"),
      requestedByAgentId: body.requestedByAgentId,
    });
    if (!approvalRequest) {
      res.status(200).json({ approvalRequest: null, message: "This recommendation's action does not require human approval." });
      return;
    }
    res.status(201).json({ approvalRequest });
  }),
);

const compileMemoSchema = z.object({ chairmanReviewId: z.string().min(1) });

/** Compiles the Investment Memo for this CEO recommendation + a specific Chairman review of it (docs/M4_ARCHITECTURE_PROPOSAL.md §17). */
ceoRecommendationsRouter.post(
  "/:id/investment-memo",
  requireAuth(),
  validateBody(compileMemoSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof compileMemoSchema>;
    const recommendation = await ceoRecommendationRepository.findById(requireParam(req, "id"));
    if (!recommendation) throw new NotFoundError("CeoRecommendation", requireParam(req, "id"));
    const actor = getActor(req);
    const result = await investmentMemoService.compile({
      opportunityId: recommendation.opportunityId,
      ceoRecommendationId: recommendation.id,
      chairmanReviewId: body.chairmanReviewId,
      actorType: actor.type,
      actorId: actor.id,
    });
    res.status(201).json(result);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { decisionRecordRepository } from "../../db/repositories/decision-record.repository.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { calibrationService } from "../../services/calibration.service.js";
import { decisionRecordService } from "../../services/decision-record.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const decisionRecordsRouter = Router();

/**
 * Registered BEFORE the /:id route below: Express would otherwise
 * match "calibration-summary" as an :id parameter value, silently
 * shadowing this route (docs/M4_ARCHITECTURE_PROPOSAL.md §28, §39).
 */
decisionRecordsRouter.get(
  "/calibration-summary",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    res.json(await calibrationService.summarize());
  }),
);

decisionRecordsRouter.get(
  "/:id",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const record = await decisionRecordRepository.findById(requireParam(req, "id"));
    if (!record) throw new NotFoundError("DecisionRecord", requireParam(req, "id"));
    res.json(record);
  }),
);

const applyDecisionSchema = z.object({ approvalRequestId: z.string().min(1) });

/**
 * The one operation a human calls to turn an already-decided
 * ApprovalRequest into an immutable DecisionRecord and — only for an
 * APPROVED KILL_OPPORTUNITY — the actual Opportunity.status = KILLED
 * transition (docs/M4_ARCHITECTURE_PROPOSAL.md §20). Human-Owner-only:
 * this is the endpoint that can actually change an opportunity's
 * status, not the approval decision itself (which already required a
 * HUMAN identity via `POST /api/decisions/:id/approve`).
 */
decisionRecordsRouter.post(
  "/",
  requireHuman(),
  validateBody(applyDecisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applyDecisionSchema>;
    const result = await decisionRecordService.applyHumanDecision({ approvalRequestId: body.approvalRequestId, actor: toActor(getActor(req)) });
    res.status(201).json(result);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { growthExperimentResultRepository } from "../../db/repositories/growth-experiment-result.repository.js";
import { growthExperimentExecutionService } from "../../services/growth-experiment-execution.service.js";
import { growthExperimentService } from "../../services/growth-experiment.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam, requireQueryParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const growthExperimentsRouter = Router();

growthExperimentsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await growthExperimentService.listForProduct(requireQueryParam(req, "productId")));
  }),
);

growthExperimentsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await growthExperimentService.getOrThrow(requireParam(req, "id")));
  }),
);

growthExperimentsRouter.get(
  "/:id/results",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await growthExperimentResultRepository.listForExperiment(requireParam(req, "id")));
  }),
);

const requestApprovalSchema = z.object({ requestedByAgentId: z.string().min(1) });

/** ANALYZED -> AWAITING_APPROVAL, with a real YELLOW-risk ApprovalRequest bound to this exact experiment id (docs/M8_ARCHITECTURE_PROPOSAL.md §25-26). */
growthExperimentsRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const approvalRequest = await growthExperimentService.requestApproval({ growthExperimentId: requireParam(req, "id"), requestedByAgentId: body.requestedByAgentId });
    res.status(201).json(approvalRequest);
  }),
);

const applyDecisionSchema = z.object({ approvalRequestId: z.string().min(1) });

/** Human-Owner-only — turns an already-decided ApprovalRequest into the experiment's own APPROVED/REJECTED status (docs/M8_ARCHITECTURE_PROPOSAL.md §25-26). */
growthExperimentsRouter.post(
  "/apply-decision",
  requireHuman(),
  validateBody(applyDecisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applyDecisionSchema>;
    const experiment = await growthExperimentService.applyDecision({ approvalRequestId: body.approvalRequestId, actor: toActor(getActor(req)) });
    res.json(experiment);
  }),
);

/** The EXECUTE step (docs/M8_ARCHITECTURE_PROPOSAL.md §25) — Human-Owner-only. Re-verifies the exact approved experiment before starting it. */
growthExperimentsRouter.post(
  "/:id/approve-to-run",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const experiment = await growthExperimentExecutionService.approveToRun({ growthExperimentId: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.status(201).json(experiment);
  }),
);

const completeExperimentSchema = z.object({
  baselineValue: z.number(),
  experimentValue: z.number(),
  sampleSize: z.number().int().min(0),
  limitations: z.string().min(1),
});

/** Mechanical recording of a real observed outcome — no fabricated statistical significance (docs/M8_ARCHITECTURE_PROPOSAL.md §16). */
growthExperimentsRouter.post(
  "/:id/complete",
  requireAuth(),
  validateBody(completeExperimentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof completeExperimentSchema>;
    const result = await growthExperimentExecutionService.completeExperiment({ growthExperimentId: requireParam(req, "id"), ...body });
    res.status(201).json(result);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { deploymentPlanRepository } from "../../db/repositories/deployment-plan.repository.js";
import { deploymentPlanService } from "../../services/deployment-plan.service.js";
import { deploymentService } from "../../services/deployment.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const deploymentPlansRouter = Router();

deploymentPlansRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await deploymentPlanRepository.findById(requireParam(req, "id")));
  }),
);

const requestApprovalSchema = z.object({ requestedByAgentId: z.string().min(1) });

/** DRAFT -> PENDING_APPROVAL, with a real RED-risk ApprovalRequest bound to this exact plan id (docs/M7_ARCHITECTURE_PROPOSAL.md §17). */
deploymentPlansRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: requireParam(req, "id"), requestedByAgentId: body.requestedByAgentId });
    res.status(201).json(approvalRequest);
  }),
);

const applyDecisionSchema = z.object({ approvalRequestId: z.string().min(1) });

/** Human-Owner-only — turns an already-decided ApprovalRequest into the plan's own HUMAN_APPROVED/REJECTED status (docs/M7_ARCHITECTURE_PROPOSAL.md §17). */
deploymentPlansRouter.post(
  "/apply-decision",
  requireHuman(),
  validateBody(applyDecisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applyDecisionSchema>;
    const plan = await deploymentPlanService.applyDecision({ approvalRequestId: body.approvalRequestId, actor: toActor(getActor(req)) });
    res.json(plan);
  }),
);

/**
 * The EXECUTE step (docs/M7_ARCHITECTURE_PROPOSAL.md §5-6, §17) —
 * Human-Owner-only. Re-verifies the exact approved plan, then calls
 * the configured DeploymentProvider (DEV_FIXTURE only in M7, §7).
 */
deploymentPlansRouter.post(
  "/:id/execute",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const deployment = await deploymentService.execute({ deploymentPlanId: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.status(201).json(deployment);
  }),
);

import { Router } from "express";
import { deploymentRepository } from "../../db/repositories/deployment.repository.js";
import { deploymentService } from "../../services/deployment.service.js";
import { monitoringService } from "../../services/monitoring.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const deploymentsRouter = Router();

deploymentsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await deploymentRepository.findById(requireParam(req, "id")));
  }),
);

/** The safety valve (docs/M7_ARCHITECTURE_PROPOSAL.md §18) — Human-Owner-only, no fresh ApprovalRequest. */
deploymentsRouter.post(
  "/:id/rollback",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const rollback = await deploymentService.rollback({ deploymentId: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.status(201).json(rollback);
  }),
);

/** On-demand only (docs/M7_ARCHITECTURE_PROPOSAL.md §12, §24) — never a background schedule. */
deploymentsRouter.post(
  "/:id/health-check",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await monitoringService.checkHealth({ deploymentId: requireParam(req, "id") }));
  }),
);

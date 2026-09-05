import { Router } from "express";
import { z } from "zod";
import { controlPlaneService } from "../../services/control-plane.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman } from "../middleware/authenticate.js";
import { validateBody } from "../middleware/validate.js";

export const controlPlaneRouter = Router();

/** Current active cycles, emergency-stop state, and company state in one read (docs/M9_ARCHITECTURE_PROPOSAL.md §54, §56). */
controlPlaneRouter.get(
  "/status",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await controlPlaneService.getStatus());
  }),
);

const emergencyStopSchema = z.object({ reason: z.string().min(1) });

/** Human-Owner-only (§57) — an agent may never halt or resume its own governance. */
controlPlaneRouter.post(
  "/emergency-stop",
  requireHuman(),
  validateBody(emergencyStopSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof emergencyStopSchema>;
    res.status(201).json(await controlPlaneService.activateEmergencyStop({ actor: getActor(req), reason: body.reason }));
  }),
);

controlPlaneRouter.post(
  "/resume",
  requireHuman(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.resumeFromEmergencyStop({ actor: getActor(req) }));
  }),
);

import { Router } from "express";
import { alertService } from "../../services/alert.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const alertsRouter = Router();

/** Company Alerts (docs/M9_ARCHITECTURE_PROPOSAL.md §35), ranked by score — unacknowledged only by default; ?all=true includes acknowledged ones too. */
alertsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const all = req.query.all === "true";
    res.json(all ? await alertService.list() : await alertService.listUnacknowledged());
  }),
);

alertsRouter.post(
  "/:id/acknowledge",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await alertService.acknowledge(requireParam(req, "id"), getActor(req).identityId));
  }),
);

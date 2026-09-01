import { Router } from "express";
import { signalService } from "../../services/signal.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const signalsRouter = Router();

signalsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const clusterId = typeof req.query.clusterId === "string" ? req.query.clusterId : undefined;
    res.json(await signalService.list({ status, clusterId }));
  }),
);

signalsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await signalService.getOrThrow(requireParam(req, "id")));
  }),
);

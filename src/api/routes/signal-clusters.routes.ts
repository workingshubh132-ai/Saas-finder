import { Router } from "express";
import { signalClusterRepository } from "../../db/repositories/signal-cluster.repository.js";
import { signalService } from "../../services/signal.service.js";
import { NotFoundError } from "../../domain/shared/errors.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const signalClustersRouter = Router();

signalClustersRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await signalClusterRepository.list({ status }));
  }),
);

signalClustersRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const cluster = await signalClusterRepository.findById(requireParam(req, "id"));
    if (!cluster) throw new NotFoundError("SignalCluster", requireParam(req, "id"));
    res.json(cluster);
  }),
);

/** Every member signal — the concrete traceability answer to "why did
 *  VentureForge form this cluster?" (M3 brief Part 15). */
signalClustersRouter.get(
  "/:id/signals",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await signalService.listByCluster(requireParam(req, "id")));
  }),
);

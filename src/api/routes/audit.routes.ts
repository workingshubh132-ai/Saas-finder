import { Router } from "express";
import { auditService } from "../../services/audit.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireHuman } from "../middleware/authenticate.js";

export const auditRouter = Router();

auditRouter.get(
  "/",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const { resourceType, resourceId, actorId } = req.query;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(
      await auditService.list({
        resourceType: typeof resourceType === "string" ? resourceType : undefined,
        resourceId: typeof resourceId === "string" ? resourceId : undefined,
        actorId: typeof actorId === "string" ? actorId : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    );
  }),
);

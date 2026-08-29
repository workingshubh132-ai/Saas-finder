import { Router } from "express";
import { agentRuntimeService } from "../../services/agent-runtime.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const agentExecutionsRouter = Router();

agentExecutionsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    res.json(await agentRuntimeService.listExecutions({ status, agentId }));
  }),
);

/** Full observability record for one execution — telemetry + every tool call it made (M2 brief Part 22). */
agentExecutionsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const execution = await agentRuntimeService.getOrThrow(requireParam(req, "id"));
    const toolExecutions = await agentRuntimeService.listToolExecutions(execution.id);
    res.json({ execution, toolExecutions });
  }),
);

import { Router } from "express";
import { z } from "zod";
import { agentService } from "../../services/agent.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const agentsRouter = Router();

const createAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  department: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  modelProvider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  parentAgentId: z.string().nullable().optional(),
  riskLevel: z.string(),
});

agentsRouter.post(
  "/",
  requireHuman(),
  validateBody(createAgentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createAgentSchema>;
    const agent = await agentService.createAgent({ ...body, createdBy: toActor(getActor(req)) });
    res.status(201).json(agent);
  }),
);

agentsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const department = typeof req.query.department === "string" ? req.query.department : undefined;
    const agents = await agentService.listAgents({ status, department });
    res.json(agents);
  }),
);

agentsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const agent = await agentService.getAgentOrThrow(requireParam(req, "id"));
    res.json(agent);
  }),
);

const transitionStatusSchema = z.object({ toStatus: z.string() });

agentsRouter.post(
  "/:id/status",
  requireAuth(),
  validateBody(transitionStatusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionStatusSchema>;
    const agent = await agentService.transitionStatus({
      id: requireParam(req, "id"),
      toStatus: body.toStatus,
      actor: toActor(getActor(req)),
    });
    res.json(agent);
  }),
);

agentsRouter.get(
  "/:id/permissions",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const permissions = await agentService.listPermissions(requireParam(req, "id"));
    res.json(permissions);
  }),
);

const grantPermissionSchema = z.object({
  permission: z.string(),
  reason: z.string().optional(),
});

agentsRouter.post(
  "/:id/permissions",
  requireHuman(),
  validateBody(grantPermissionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof grantPermissionSchema>;
    const grant = await agentService.grantPermission({
      agentId: requireParam(req, "id"),
      ...body,
      grantedBy: toActor(getActor(req)),
    });
    res.status(201).json(grant);
  }),
);

agentsRouter.post(
  "/:id/permissions/:permissionId/revoke",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const grant = await agentService.revokePermission({
      permissionId: requireParam(req, "permissionId"),
      revokedBy: toActor(getActor(req)),
    });
    res.json(grant);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { agentService } from "../../services/agent.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const agentsRouter = Router();

const actorSchema = z.object({
  actorType: z.enum(["AGENT", "HUMAN", "SYSTEM"]),
  actorId: z.string().min(1),
});

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
  createdBy: z.string().min(1),
});

agentsRouter.post(
  "/",
  validateBody(createAgentSchema),
  asyncHandler(async (req, res) => {
    const agent = await agentService.createAgent(req.body as z.infer<typeof createAgentSchema>);
    res.status(201).json(agent);
  }),
);

agentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const department = typeof req.query.department === "string" ? req.query.department : undefined;
    const agents = await agentService.listAgents({ status, department });
    res.json(agents);
  }),
);

agentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const agent = await agentService.getAgentOrThrow(requireParam(req, "id"));
    res.json(agent);
  }),
);

const transitionStatusSchema = z.object({ toStatus: z.string() }).merge(actorSchema);

agentsRouter.post(
  "/:id/status",
  validateBody(transitionStatusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionStatusSchema>;
    const agent = await agentService.transitionStatus({
      id: requireParam(req, "id"),
      toStatus: body.toStatus,
      actor: { actorType: body.actorType, actorId: body.actorId },
    });
    res.json(agent);
  }),
);

agentsRouter.get(
  "/:id/permissions",
  asyncHandler(async (req, res) => {
    const permissions = await agentService.listPermissions(requireParam(req, "id"));
    res.json(permissions);
  }),
);

const grantPermissionSchema = z.object({
  permission: z.string(),
  grantedBy: z.string().min(1),
  reason: z.string().optional(),
});

agentsRouter.post(
  "/:id/permissions",
  validateBody(grantPermissionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof grantPermissionSchema>;
    const grant = await agentService.grantPermission({ agentId: requireParam(req, "id"), ...body });
    res.status(201).json(grant);
  }),
);

const revokePermissionSchema = z.object({ revokedBy: z.string().min(1) });

agentsRouter.post(
  "/:id/permissions/:permissionId/revoke",
  validateBody(revokePermissionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof revokePermissionSchema>;
    const grant = await agentService.revokePermission({
      permissionId: requireParam(req, "permissionId"),
      revokedBy: body.revokedBy,
    });
    res.json(grant);
  }),
);

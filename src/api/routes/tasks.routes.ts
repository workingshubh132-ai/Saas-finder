import { Router } from "express";
import { z } from "zod";
import { taskService } from "../../services/task.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const tasksRouter = Router();

const createTaskSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  assignedAgentId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  priority: z.string().optional(),
  riskLevel: z.string(),
  input: z.unknown().optional(),
});

tasksRouter.post(
  "/",
  requireAuth(),
  validateBody(createTaskSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createTaskSchema>;
    const task = await taskService.createTask({ ...body, actor: toActor(getActor(req)) });
    res.status(201).json(task);
  }),
);

tasksRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const assignedAgentId = typeof req.query.assignedAgentId === "string" ? req.query.assignedAgentId : undefined;
    const tasks = await taskService.listTasks({ status, assignedAgentId });
    res.json(tasks);
  }),
);

tasksRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const task = await taskService.getTaskOrThrow(requireParam(req, "id"));
    res.json(task);
  }),
);

const transitionTaskSchema = z
  .object({ toStatus: z.string(), output: z.unknown().optional(), error: z.string().optional() })
  .strict();

tasksRouter.post(
  "/:id/transition",
  requireAuth(),
  validateBody(transitionTaskSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionTaskSchema>;
    const task = await taskService.transition({ id: requireParam(req, "id"), ...body, actor: toActor(getActor(req)) });
    res.json(task);
  }),
);

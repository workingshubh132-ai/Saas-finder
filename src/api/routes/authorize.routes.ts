import { Router } from "express";
import { z } from "zod";
import { authorizationService } from "../../services/authorization.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validateBody } from "../middleware/validate.js";

export const authorizeRouter = Router();

const authorizeSchema = z.object({
  agentId: z.string().min(1),
  action: z.string(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

authorizeRouter.post(
  "/",
  validateBody(authorizeSchema),
  asyncHandler(async (req, res) => {
    const decision = await authorizationService.authorize(req.body as z.infer<typeof authorizeSchema>);
    res.json(decision);
  }),
);

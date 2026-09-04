import { Router } from "express";
import { z } from "zod";
import { SUPPORT_CASE_STATUSES } from "../../domain/support-case/support-case.types.js";
import { supportAgentService } from "../../services/support-agent.service.js";
import { supportCaseService } from "../../services/support-case.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const supportCasesRouter = Router();

supportCasesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await supportCaseService.getOrThrow(requireParam(req, "id")));
  }),
);

const createSupportCaseSchema = z.object({ productId: z.string().min(1), customerRef: z.string().min(1), requestText: z.string().min(1) });

/** Human-pasted only — no connector, same privacy boundary as CustomerResponse (docs/M7_ARCHITECTURE_PROPOSAL.md §25, §36). */
supportCasesRouter.post(
  "/",
  requireAuth(),
  validateBody(createSupportCaseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSupportCaseSchema>;
    const supportCase = await supportCaseService.create({ ...body, actor: toActor(getActor(req)) });
    res.status(201).json(supportCase);
  }),
);

const triageSchema = z.object({ agentId: z.string().min(1) });

/** Judgment only — never mutates status itself (docs/M7_ARCHITECTURE_PROPOSAL.md §25). */
supportCasesRouter.post(
  "/:id/triage",
  requireAuth(),
  validateBody(triageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof triageSchema>;
    const outcome = await supportAgentService.run({ agentId: body.agentId, supportCaseId: requireParam(req, "id"), startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Support Agent execution did not complete.", execution: outcome.execution });
      return;
    }
    res.json(outcome.result);
  }),
);

const setStatusSchema = z.object({ status: z.enum(SUPPORT_CASE_STATUSES) });

supportCasesRouter.post(
  "/:id/status",
  requireAuth(),
  validateBody(setStatusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof setStatusSchema>;
    const supportCase = await supportCaseService.setStatus(requireParam(req, "id"), body.status, toActor(getActor(req)));
    res.json(supportCase);
  }),
);

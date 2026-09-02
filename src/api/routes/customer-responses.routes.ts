import { Router } from "express";
import { z } from "zod";
import { customerResponseService } from "../../services/customer-response.service.js";
import { responseAnalystService } from "../../services/response-analyst.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const customerResponsesRouter = Router();

customerResponsesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await customerResponseService.getOrThrow(requireParam(req, "id")));
  }),
);

const recordResponseSchema = z.object({ outreachMessageId: z.string().min(1), rawContent: z.string().min(1) });

/**
 * Response ingestion (docs/M5_ARCHITECTURE_PROPOSAL.md §14, brief §16)
 * — a human pastes the raw response text tied to one already-CONTACTED
 * OutreachMessage. Human-Owner-only: the response is being manually
 * transcribed from a real external channel VentureForge has no
 * programmatic access to.
 */
customerResponsesRouter.post(
  "/",
  requireHuman(),
  validateBody(recordResponseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordResponseSchema>;
    const response = await customerResponseService.record({ ...body, actor: toActor(getActor(req)) });
    res.status(201).json(response);
  }),
);

const runAnalystSchema = z.object({ agentId: z.string().min(1) });

/**
 * Classifies the response and extracts zero-or-more CustomerEvidence-
 * wrapped Evidence rows (docs/M5_ARCHITECTURE_PROPOSAL.md §15-17) — the
 * response text is untrusted, potentially adversarial, human-supplied
 * data throughout; it can influence wording, never trigger a tool call
 * or bypass any gate.
 */
customerResponsesRouter.post(
  "/:id/analyze",
  requireAuth(),
  validateBody(runAnalystSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runAnalystSchema>;
    const outcome = await responseAnalystService.run({ agentId: body.agentId, customerResponseId: requireParam(req, "id"), startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Response Analyst execution did not complete.", execution: outcome.execution });
      return;
    }
    res.status(200).json(outcome.result);
  }),
);

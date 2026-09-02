import { Router } from "express";
import { z } from "zod";
import { messageApprovalService } from "../../services/message-approval.service.js";
import { messageDrafterService } from "../../services/message-drafter.service.js";
import { outreachMessageService } from "../../services/outreach-message.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const outreachMessagesRouter = Router();

outreachMessagesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await outreachMessageService.getOrThrow(requireParam(req, "id")));
  }),
);

const draftMessageSchema = z.object({ agentId: z.string().min(1), experimentId: z.string().min(1), prospectId: z.string().min(1) });

/**
 * Drafts, never sends (docs/M5_ARCHITECTURE_PROPOSAL.md §12) — no
 * route in this codebase sends an external message; there is no such
 * capability to expose. Requires the experiment to already be ACTIVE.
 */
outreachMessagesRouter.post(
  "/",
  requireAuth(),
  validateBody(draftMessageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof draftMessageSchema>;
    const outcome = await messageDrafterService.run({ ...body, startedBy: getActor(req) });
    if (outcome.status !== "COMPLETED") {
      res.status(422).json({ error: "Message Drafter execution did not complete.", execution: outcome.execution });
      return;
    }
    res.status(201).json(outcome.result);
  }),
);

const requestApprovalSchema = z.object({ requestedByAgentId: z.string().min(1) });

/** DRAFT -> AWAITING_HUMAN_APPROVAL, with a real RED-risk ApprovalRequest bound to this exact message id (docs/M5_ARCHITECTURE_PROPOSAL.md §13). */
outreachMessagesRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: requireParam(req, "id"), requestedByAgentId: body.requestedByAgentId });
    res.status(201).json(approvalRequest);
  }),
);

const applyDecisionSchema = z.object({ approvalRequestId: z.string().min(1) });

/** Human-Owner-only — turns an already-decided ApprovalRequest into the message's own APPROVED_TO_CONTACT/REJECTED status (docs/M5_ARCHITECTURE_PROPOSAL.md §13). */
outreachMessagesRouter.post(
  "/apply-decision",
  requireHuman(),
  validateBody(applyDecisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applyDecisionSchema>;
    const message = await messageApprovalService.applyDecision({ approvalRequestId: body.approvalRequestId, actor: toActor(getActor(req)) });
    res.json(message);
  }),
);

/**
 * Human-Owner-only record-keeping (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §13) — there is no programmatic send capability anywhere in this
 * codebase for this endpoint to trigger. The Human Owner personally
 * sends the approved text through their own channel, then confirms it
 * here.
 */
outreachMessagesRouter.post(
  "/:id/mark-contacted",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const message = await messageApprovalService.markContacted({ outreachMessageId: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.json(message);
  }),
);

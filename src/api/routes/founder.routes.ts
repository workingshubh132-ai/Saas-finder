import { Router } from "express";
import { decisionCardService } from "../../services/decision-card.service.js";
import { founderAttentionService } from "../../services/founder-attention.service.js";
import { founderCockpitService } from "../../services/founder-cockpit.service.js";
import { founderDecisionQueueService } from "../../services/founder-decision-queue.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";

export const founderRouter = Router();

/** The Founder Cockpit (§44) — one screen answering §32's own question list; recording this view is what scopes the next "since last review" timeline slice. */
founderRouter.get(
  "/cockpit",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await founderCockpitService.getCockpit(getActor(req).identityId));
  }),
);

/** The ranked Founder Attention Queue (docs/M9_ARCHITECTURE_PROPOSAL.md §18-19) — reads back already-scored, persisted items; never re-scores on a GET. */
founderRouter.get(
  "/attention-queue",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await founderAttentionService.listQueue());
  }),
);

/** Re-scores the current Human Decision Queue and persists any newly-surfaced item — the one write behind an otherwise read-only queue. */
founderRouter.post(
  "/attention-queue/refresh",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.status(201).json(await founderAttentionService.refresh());
  }),
);

founderRouter.post(
  "/attention-queue/:id/review",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await founderAttentionService.markReviewed(requireParam(req, "id")));
  }),
);

/** Decision Cards (§20) for the full pending Human Decision Queue — the memo-shaped alias of the attention queue. */
founderRouter.get(
  "/decisions",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    const entries = await founderDecisionQueueService.listPending();
    res.json(await decisionCardService.buildAll(entries));
  }),
);

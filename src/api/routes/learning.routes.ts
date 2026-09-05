import { Router } from "express";
import { z } from "zod";
import { decisionOutcomeRepository } from "../../db/repositories/decision-outcome.repository.js";
import { learningRecordRepository } from "../../db/repositories/learning-record.repository.js";
import { decisionMemoryService } from "../../services/decision-memory.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAuth } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const learningRouter = Router();

/** Recent LearningRecord rows (docs/M9_ARCHITECTURE_PROPOSAL.md §54) — distinct from /api/learning-records (M8), which exposes the same repository at its own path; this is the M9-namespaced read the brief's endpoint table names. */
learningRouter.get(
  "/records",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await learningRecordRepository.list());
  }),
);

/** Recent DecisionOutcome rows (§27-28). */
learningRouter.get(
  "/outcomes",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await decisionOutcomeRepository.list());
  }),
);

/** "Have we made this mistake before?" (§27, M9 brief §15) — past decisions of the same kind that generated a real lesson. */
learningRouter.get(
  "/similar/:decisionType",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await decisionMemoryService.findSimilarPastDecisions(requireParam(req, "decisionType")));
  }),
);

/** Expected-vs-actual history for one specific decision resource (§27). */
learningRouter.get(
  "/outcomes/:decisionType/:decisionResourceId",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await decisionMemoryService.getHistory(requireParam(req, "decisionType"), requireParam(req, "decisionResourceId")));
  }),
);

const recordExpectationSchema = z.object({
  decisionType: z.string().min(1),
  decisionResourceId: z.string().min(1),
  expectedMetricType: z.string().nullable().optional(),
  expectedValue: z.number().nullable().optional(),
});

/** Records what a decision expected to happen, before the outcome is known (§27). */
learningRouter.post(
  "/outcomes",
  requireAuth(),
  validateBody(recordExpectationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordExpectationSchema>;
    res.status(201).json(await decisionMemoryService.recordExpectation(body));
  }),
);

const evaluateOutcomeSchema = z.object({ actualValue: z.number(), learningRecordId: z.string().nullable().optional() });

/** Records what actually happened against a prior expectation — exactly once per DecisionOutcome. */
learningRouter.post(
  "/outcomes/:id/evaluate",
  requireAuth(),
  validateBody(evaluateOutcomeSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof evaluateOutcomeSchema>;
    res.json(await decisionMemoryService.evaluateOutcome({ decisionOutcomeId: requireParam(req, "id"), actualValue: body.actualValue, learningRecordId: body.learningRecordId ?? null }));
  }),
);

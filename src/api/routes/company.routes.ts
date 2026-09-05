import { Router } from "express";
import { z } from "zod";
import { companyRecommendationRepository } from "../../db/repositories/company-recommendation.repository.js";
import { companyReviewRepository } from "../../db/repositories/company-review.repository.js";
import { briefingService } from "../../services/briefing.service.js";
import { companyRecommendationService } from "../../services/company-recommendation.service.js";
import { controlPlaneService } from "../../services/control-plane.service.js";
import { operatingEfficiencyService } from "../../services/operating-efficiency.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const companyRouter = Router();

/** Company State (docs/M9_ARCHITECTURE_PROPOSAL.md §21, §54) — real aggregation, no persisted snapshot. */
companyRouter.get(
  "/state",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await controlPlaneService.getCompanyState());
  }),
);

/** The Company Timeline (§43) — optional ?since=<ISO date>&limit=<n>. */
companyRouter.get(
  "/timeline",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const sinceRaw = req.query.since;
    const since = typeof sinceRaw === "string" && sinceRaw.length > 0 ? new Date(sinceRaw) : undefined;
    const limitRaw = req.query.limit;
    const limit = typeof limitRaw === "string" && limitRaw.length > 0 ? Number(limitRaw) : undefined;
    res.json(await controlPlaneService.getTimeline(since, limit));
  }),
);

/** The latest Weekend Briefing (§46) — null if none has been generated yet. */
companyRouter.get(
  "/briefing",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await briefingService.getLatest());
  }),
);

const generateBriefingSchema = z.object({ periodStart: z.string().datetime().optional(), periodEnd: z.string().datetime().optional() });

/** Force-generates a fresh Briefing for the given period (default: the last 7 days). */
companyRouter.post(
  "/briefing",
  requireAuth(),
  validateBody(generateBriefingSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof generateBriefingSchema>;
    const periodStart = body.periodStart ? new Date(body.periodStart) : undefined;
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : undefined;
    res.status(201).json(await briefingService.generate(periodStart, periodEnd));
  }),
);

/** Operating Efficiency Metrics (§49) — optional ?period=<ISO week, e.g. 2026-W36>, defaults to the current week. */
companyRouter.get(
  "/efficiency",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    res.json(await operatingEfficiencyService.getMetrics(typeof period === "string" && period.length > 0 ? period : undefined));
  }),
);

/** The CEO's company-level recommendations (§31-34) — undecided-first ordering is the founder's own job (attention queue); this is the raw list. */
companyRouter.get(
  "/recommendations",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await companyRecommendationRepository.list());
  }),
);

companyRouter.get(
  "/recommendations/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const id = requireParam(req, "id");
    const [recommendation, review] = await Promise.all([companyRecommendationRepository.getOrThrow(id), companyReviewRepository.findLatestForRecommendation(id)]);
    res.json({ recommendation, review });
  }),
);

const decideCompanyRecommendationSchema = z.object({ decision: z.string().min(1), reason: z.string().nullable().optional() });

/**
 * The Human Owner's decision on a company-level recommendation (§33-34)
 * — the one write the conflict-resolution flow (CEO=INVEST vs.
 * Chairman=REJECT, §34) actually terminates on; no execution follows
 * from a CompanyRecommendation until this is called. Human-Owner-only,
 * same as every other terminal APPROVE/REJECT decision in this system.
 */
companyRouter.post(
  "/recommendations/:id/decide",
  requireHuman(),
  validateBody(decideCompanyRecommendationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decideCompanyRecommendationSchema>;
    const updated = await companyRecommendationService.recordHumanDecision({
      companyRecommendationId: requireParam(req, "id"),
      decision: body.decision,
      reason: body.reason ?? null,
      actor: toActor(getActor(req)),
    });
    res.json(updated);
  }),
);

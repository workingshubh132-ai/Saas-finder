import { Router } from "express";
import { z } from "zod";
import { ceoRecommendationRepository } from "../../db/repositories/ceo-recommendation.repository.js";
import { claimRepository } from "../../db/repositories/claim.repository.js";
import { decisionCycleRepository } from "../../db/repositories/decision-cycle.repository.js";
import { decisionRecordRepository } from "../../db/repositories/decision-record.repository.js";
import { evidenceGapRepository } from "../../db/repositories/evidence-gap.repository.js";
import { investmentMemoRepository } from "../../db/repositories/investment-memo.repository.js";
import { AuthorizationDeniedError } from "../../domain/shared/errors.js";
import { approvalService } from "../../services/approval.service.js";
import { chairmanService } from "../../services/chairman.service.js";
import { opportunityService } from "../../services/opportunity.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const opportunitiesRouter = Router();

const createOpportunitySchema = z.object({
  title: z.string().min(1),
  problem: z.string().min(1),
  targetCustomer: z.string().min(1),
  description: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

opportunitiesRouter.post(
  "/",
  requireAuth(),
  validateBody(createOpportunitySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createOpportunitySchema>;
    const opportunity = await opportunityService.createOpportunity({ ...body, discoveredBy: toActor(getActor(req)) });
    res.status(201).json(opportunity);
  }),
);

opportunitiesRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await opportunityService.listOpportunities({ status }));
  }),
);

opportunitiesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.getOrThrow(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/evidence",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.listEvidence(requireParam(req, "id")));
  }),
);

const attachEvidenceSchema = z.object({ evidenceId: z.string().min(1) });

opportunitiesRouter.post(
  "/:id/evidence",
  requireAuth(),
  validateBody(attachEvidenceSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof attachEvidenceSchema>;
    const evidence = await opportunityService.attachEvidence({
      opportunityId: requireParam(req, "id"),
      ...body,
      actor: toActor(getActor(req)),
    });
    res.status(201).json(evidence);
  }),
);

const dimensionsSchema = z.object({
  pain: z.number().min(0).max(1),
  demand: z.number().min(0).max(1),
  willingnessToPay: z.number().min(0).max(1),
  reachability: z.number().min(0).max(1),
  retention: z.number().min(0).max(1),
  differentiation: z.number().min(0).max(1),
  buildability: z.number().min(0).max(1),
  economics: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
  evidenceQuality: z.number().min(0).max(1),
  marketSize: z.number().min(0).max(1),
  frequency: z.number().min(0).max(1),
  evidenceIndependence: z.number().min(0).max(1),
  timing: z.number().min(0).max(1),
});

const scoreOpportunitySchema = z.object({ dimensions: dimensionsSchema, scoredBy: z.string().min(1) });

opportunitiesRouter.post(
  "/:id/score",
  requireAuth(),
  validateBody(scoreOpportunitySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof scoreOpportunitySchema>;
    const opportunity = await opportunityService.scoreOpportunity({ opportunityId: requireParam(req, "id"), ...body });
    res.json(opportunity);
  }),
);

opportunitiesRouter.get(
  "/:id/scores",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await opportunityService.listScoreHistory(requireParam(req, "id")));
  }),
);

const transitionSchema = z.object({ toStatus: z.string() });

opportunitiesRouter.post(
  "/:id/status",
  requireAuth(),
  validateBody(transitionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionSchema>;
    const opportunity = await opportunityService.transition({
      id: requireParam(req, "id"),
      ...body,
      actor: toActor(getActor(req)),
    });
    res.json(opportunity);
  }),
);

const validationLevelSchema = z.object({ validationLevel: z.string() });

opportunitiesRouter.post(
  "/:id/validation-level",
  requireAuth(),
  validateBody(validationLevelSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof validationLevelSchema>;
    const opportunity = await opportunityService.setValidationLevel({
      id: requireParam(req, "id"),
      ...body,
      actor: toActor(getActor(req)),
    });
    res.json(opportunity);
  }),
);

/** Triggers a new Chairman review (M2 brief Parts 15-16). Feeds the Human Decision Queue; never itself decides anything. */
opportunitiesRouter.post(
  "/:id/chairman-review",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const result = await chairmanService.review({ opportunityId: requireParam(req, "id"), reviewedBy: getActor(req) });
    res.status(201).json(result);
  }),
);

opportunitiesRouter.get(
  "/:id/chairman-reviews",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await chairmanService.listReviews(requireParam(req, "id")));
  }),
);

const requestApprovalSchema = z.object({
  requestedByAgentId: z.string().min(1),
  action: z.string(),
  description: z.string().min(1),
  riskLevel: z.string(),
  reason: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
});

/**
 * The formal ask that puts this opportunity in front of the Human
 * Decision Queue (Constitution §28: PROPOSAL -> CEO -> CHAIRMAN REVIEW
 * -> GUARDIAN REVIEW -> HUMAN APPROVAL) — a separate, explicit step
 * from discovering/scoring it (researchAgentService) and from
 * Chairman review (chairmanService), matching that four-stage
 * pipeline rather than folding every stage into one call.
 */
opportunitiesRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const actor = getActor(req);
    if (actor.type === "AGENT" && body.requestedByAgentId !== actor.id) {
      throw new AuthorizationDeniedError("An AGENT identity can only request approval attributed to itself.");
    }
    const request = await approvalService.requestApproval({
      ...body,
      resourceType: "OPPORTUNITY",
      resourceId: requireParam(req, "id"),
    });
    res.status(201).json(request);
  }),
);

/** Known unknowns/assumptions and the ranked next-best-research-question (M3 brief Part 31). */
opportunitiesRouter.get(
  "/:id/evidence-gaps",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await evidenceGapRepository.listForOpportunity(requireParam(req, "id")));
  }),
);

// --- M4 — docs/M4_ARCHITECTURE_PROPOSAL.md §22. ---

opportunitiesRouter.get(
  "/:id/claims",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await claimRepository.listForOpportunity(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/ceo-recommendations",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await ceoRecommendationRepository.listForOpportunity(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/investment-memos",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await investmentMemoRepository.listForOpportunity(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/decision-records",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await decisionRecordRepository.listForOpportunity(requireParam(req, "id")));
  }),
);

opportunitiesRouter.get(
  "/:id/decision-cycles",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await decisionCycleRepository.list({ opportunityId: requireParam(req, "id") }));
  }),
);

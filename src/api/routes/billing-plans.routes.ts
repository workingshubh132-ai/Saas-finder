import { Router } from "express";
import { z } from "zod";
import { billingPlanRepository } from "../../db/repositories/billing-plan.repository.js";
import { billingActivationService } from "../../services/billing-activation.service.js";
import { billingPlanService } from "../../services/billing-plan.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const billingPlansRouter = Router();

billingPlansRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await billingPlanRepository.findById(requireParam(req, "id")));
  }),
);

const createBillingPlanSchema = z.object({ productId: z.string().min(1), pricingModelId: z.string().min(1), provider: z.string().min(1) });

/** Mechanical wrapping of an already-judged PricingModel into billing-approval shape (docs/M7_ARCHITECTURE_PROPOSAL.md §19). */
billingPlansRouter.post(
  "/",
  requireAuth(),
  validateBody(createBillingPlanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBillingPlanSchema>;
    res.status(201).json(await billingPlanService.create(body));
  }),
);

const requestApprovalSchema = z.object({ requestedByAgentId: z.string().min(1) });

/** DRAFT stays DRAFT until decided, with a real RED-risk ApprovalRequest bound to this exact plan id (docs/M7_ARCHITECTURE_PROPOSAL.md §19). */
billingPlansRouter.post(
  "/:id/request-approval",
  requireAuth(),
  validateBody(requestApprovalSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof requestApprovalSchema>;
    const approvalRequest = await billingPlanService.requestApproval({ billingPlanId: requireParam(req, "id"), requestedByAgentId: body.requestedByAgentId });
    res.status(201).json(approvalRequest);
  }),
);

const applyDecisionSchema = z.object({ approvalRequestId: z.string().min(1) });

billingPlansRouter.post(
  "/apply-decision",
  requireHuman(),
  validateBody(applyDecisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof applyDecisionSchema>;
    const plan = await billingPlanService.applyDecision({ approvalRequestId: body.approvalRequestId, actor: toActor(getActor(req)) });
    res.json(plan);
  }),
);

/**
 * The ACTIVATE_BILLING EXECUTE step (docs/M7_ARCHITECTURE_PROPOSAL.md
 * §5-6, §19) — Human-Owner-only. The moment real payment collection
 * becomes possible for this product (against the DEV_FIXTURE provider only, §7).
 */
billingPlansRouter.post(
  "/:id/activate",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const billingAccount = await billingActivationService.activate({ billingPlanId: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.status(201).json(billingAccount);
  }),
);

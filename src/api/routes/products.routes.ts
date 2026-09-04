import { Router } from "express";
import { z } from "zod";
import { engineeringTaskRepository } from "../../db/repositories/engineering-task.repository.js";
import { launchPlanRepository } from "../../db/repositories/launch-plan.repository.js";
import { launchReviewMemoRepository } from "../../db/repositories/launch-review-memo.repository.js";
import { mvpArchitectureRepository } from "../../db/repositories/mvp-architecture.repository.js";
import { productReviewMemoRepository } from "../../db/repositories/product-review-memo.repository.js";
import { productSpecRepository } from "../../db/repositories/product-spec.repository.js";
import { launchOperationsService } from "../../services/launch-operations.service.js";
import { productFactoryService } from "../../services/product-factory.service.js";
import { productService } from "../../services/product.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, toActor } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const productsRouter = Router();

const createProductSchema = z.object({ opportunityId: z.string().min(1) });

/** Proposes a new build attempt for an opportunity (docs/M6_ARCHITECTURE_PROPOSAL.md §21) — PROPOSED, not yet APPROVED. */
productsRouter.post(
  "/",
  requireAuth(),
  validateBody(createProductSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createProductSchema>;
    const actor = getActor(req);
    const product = await productService.create({ opportunityId: body.opportunityId, createdByIdentityId: actor.identityId });
    res.status(201).json(product);
  }),
);

productsRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    res.json(await productService.list());
  }),
);

productsRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await productService.getOrThrow(requireParam(req, "id")));
  }),
);

/** The first hard human gate (docs/M6_ARCHITECTURE_PROPOSAL.md §23) — only a verified HUMAN may open a build attempt. */
productsRouter.post(
  "/:id/approve",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const product = await productService.approve({ id: requireParam(req, "id"), actor: toActor(getActor(req)) });
    res.json(product);
  }),
);

productsRouter.get(
  "/:id/spec",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await productSpecRepository.findLatestForProduct(requireParam(req, "id")));
  }),
);

productsRouter.get(
  "/:id/architecture",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await mvpArchitectureRepository.findLatestForProduct(requireParam(req, "id")));
  }),
);

productsRouter.get(
  "/:id/engineering-tasks",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await engineeringTaskRepository.listForProduct(requireParam(req, "id")));
  }),
);

productsRouter.get(
  "/:id/memos",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await productReviewMemoRepository.listForProduct(requireParam(req, "id")));
  }),
);

const buildProductSchema = z.object({
  strategistAgentId: z.string().min(1),
  architectAgentId: z.string().min(1),
  uxAgentId: z.string().min(1),
  engineeringAgentId: z.string().min(1),
  codeReviewAgentId: z.string().min(1),
  qaAgentId: z.string().min(1),
  securityAgentId: z.string().min(1),
  ceoAgentId: z.string().min(1),
});

/**
 * The whole SaaS Factory technical pipeline, over HTTP
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §2, §21) — runs an APPROVED
 * Product all the way to a compiled memo in HUMAN_REVIEW, mirroring
 * POST /api/decision-cycles' own precedent: Human-Owner-only to
 * start, no autonomous deployment ever happens from here.
 */
productsRouter.post(
  "/:id/build",
  requireHuman(),
  validateBody(buildProductSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof buildProductSchema>;
    const summary = await productFactoryService.build({ productId: requireParam(req, "id"), ...body, startedBy: getActor(req) });
    res.status(201).json(summary);
  }),
);

productsRouter.get(
  "/:id/launch-plans",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await launchPlanRepository.findLatestForProduct(requireParam(req, "id")));
  }),
);

productsRouter.get(
  "/:id/launch-review-memos",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await launchReviewMemoRepository.findLatestForProduct(requireParam(req, "id")));
  }),
);

const planLaunchSchema = z.object({
  launchStrategistAgentId: z.string().min(1),
  pricingAgentId: z.string().min(1),
  gtmAgentId: z.string().min(1),
  ceoAgentId: z.string().min(1),
});

/**
 * The launch-planning pipeline, over HTTP
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §5, §17, §28-31) — runs a
 * READY_FOR_DEPLOYMENT Product all the way to a compiled
 * LaunchReviewMemo in AWAITING_LAUNCH_APPROVAL, mirroring POST
 * /:id/build's own precedent: Human-Owner-only to start, PLANNING
 * only — never a deployment, billing activation, or spend.
 */
productsRouter.post(
  "/:id/plan-launch",
  requireHuman(),
  validateBody(planLaunchSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof planLaunchSchema>;
    const summary = await launchOperationsService.planLaunch({ productId: requireParam(req, "id"), ...body, startedBy: getActor(req) });
    res.status(201).json(summary);
  }),
);

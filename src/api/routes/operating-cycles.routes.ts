import { Router } from "express";
import { z } from "zod";
import type { CycleKind } from "../../domain/operating-cycle/operating-cycle.types.js";
import { controlPlaneService } from "../../services/control-plane.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const operatingCyclesRouter = Router();

const startCycleSchema = z.object({
  definition: z.object({
    objective: z.string().min(1),
    scope: z.string().min(1),
    maxCostUsd: z.number().positive(),
    riskLevel: z.string().min(1),
    deadline: z.string().datetime().nullable(),
    owner: z.string().min(1),
  }),
  kind: z.string().min(1).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

/** Starts a new OperatingCycle (docs/M9_ARCHITECTURE_PROPOSAL.md §17, §41) — idempotencyKey-aware; a second call with the same key returns the existing cycle unchanged. */
operatingCyclesRouter.post(
  "/",
  requireAuth(),
  validateBody(startCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof startCycleSchema>;
    const cycle = await controlPlaneService.startCycle({
      definition: { ...body.definition, deadline: body.definition.deadline ? new Date(body.definition.deadline) : null },
      startedBy: getActor(req),
      kind: body.kind as CycleKind | undefined,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    res.status(201).json(cycle);
  }),
);

operatingCyclesRouter.get(
  "/",
  requireAuth(),
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    const stage = req.query.stage;
    res.json(await controlPlaneService.listCycles({ status: typeof status === "string" ? status : undefined, stage: typeof stage === "string" ? stage : undefined }));
  }),
);

operatingCyclesRouter.get(
  "/:id",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.getCycle(requireParam(req, "id")));
  }),
);

operatingCyclesRouter.get(
  "/:id/stage-history",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.getCycleStageHistory(requireParam(req, "id")));
  }),
);

/** A SCHEDULED cycle whose time has come (or a human starting it early) — status only; the first advance/run-next-stage call moves the stage. */
operatingCyclesRouter.post(
  "/:id/begin",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.beginScheduledCycle(requireParam(req, "id")));
  }),
);

const advanceCycleSchema = z.object({ summary: z.string().nullable().optional() });

/** Pure bookkeeping transition (§17) — assumes the caller already did the current stage's real work; use run-next-stage to have the control plane do that work itself. */
operatingCyclesRouter.post(
  "/:id/advance",
  requireAuth(),
  validateBody(advanceCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof advanceCycleSchema>;
    res.json(await controlPlaneService.advanceCycle({ cycleId: requireParam(req, "id"), actor: getActor(req), summary: body.summary ?? null }));
  }),
);

const runNextStageSchema = z.object({ ceoAgentId: z.string().min(1).optional() });

/** Does the current stage's real work via the existing, unmodified orchestrators, then advances (§14) — the primary way a caller actually drives a cycle forward. */
operatingCyclesRouter.post(
  "/:id/run-next-stage",
  requireAuth(),
  validateBody(runNextStageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof runNextStageSchema>;
    res.json(await controlPlaneService.runNextStage({ cycleId: requireParam(req, "id"), actor: getActor(req), ceoAgentId: body.ceoAgentId }));
  }),
);

const routeToAwaitingHumanSchema = z.object({ reason: z.string().min(1) });

operatingCyclesRouter.post(
  "/:id/route-to-awaiting-human",
  requireAuth(),
  validateBody(routeToAwaitingHumanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof routeToAwaitingHumanSchema>;
    res.json(await controlPlaneService.routeToAwaitingHuman({ cycleId: requireParam(req, "id"), reason: body.reason }));
  }),
);

const resumeFromAwaitingHumanSchema = z.object({ decisionSummary: z.string().min(1) });

/** A human has decided — re-enters exactly the stage that requested review (§15). */
operatingCyclesRouter.post(
  "/:id/resume-from-awaiting-human",
  requireHuman(),
  validateBody(resumeFromAwaitingHumanSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof resumeFromAwaitingHumanSchema>;
    res.json(await controlPlaneService.resumeFromAwaitingHuman({ cycleId: requireParam(req, "id"), actor: getActor(req), decisionSummary: body.decisionSummary }));
  }),
);

const pauseCycleSchema = z.object({ reason: z.string().min(1) });

/** Human-Owner-only (Constitution §8) — a deliberate halt, distinct from the automatic STOPPED (budget exhaustion). */
operatingCyclesRouter.post(
  "/:id/pause",
  requireHuman(),
  validateBody(pauseCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof pauseCycleSchema>;
    res.json(await controlPlaneService.pauseCycle({ cycleId: requireParam(req, "id"), actor: getActor(req), reason: body.reason }));
  }),
);

operatingCyclesRouter.post(
  "/:id/resume",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.resumeCycle({ cycleId: requireParam(req, "id"), actor: getActor(req) }));
  }),
);

const cancelCycleSchema = z.object({ reason: z.string().min(1) });

/** Human-Owner-only — a deliberate stop. */
operatingCyclesRouter.post(
  "/:id/cancel",
  requireHuman(),
  validateBody(cancelCycleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof cancelCycleSchema>;
    res.json(await controlPlaneService.cancelCycle({ cycleId: requireParam(req, "id"), actor: getActor(req), reason: body.reason }));
  }),
);

/** A FAILED cycle's fresh continuation (§17, §37) — resumes at the stage after the last one that fully completed; never mutates the failed row. */
operatingCyclesRouter.post(
  "/:id/retry",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json(await controlPlaneService.retryCycle({ cycleId: requireParam(req, "id"), actor: getActor(req) }));
  }),
);

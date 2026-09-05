import type { CycleStageEvent, OperatingCycle } from "@prisma/client";
import { operatingCycleRepository } from "../db/repositories/operating-cycle.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import {
  CYCLE_STAGE_TRANSITIONS,
  CYCLE_STAGES,
  isCycleKind,
  isCycleStage,
  resolveResumeStage,
  type CycleKind,
  type CycleStage,
  type OperatingCycleDefinition,
} from "../domain/operating-cycle/operating-cycle.types.js";
import { CYCLE_STATUS_TRANSITIONS, isCycleStatus, type CycleStatus } from "../domain/shared/cycle-lifecycle.js";
import { ValidationError } from "../domain/shared/errors.js";
import { isRiskLevel } from "../domain/risk/risk-level.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { alertService } from "./alert.service.js";
import { auditService } from "./audit.service.js";
import { companyBudgetService } from "./company-budget.service.js";
import { emergencyStopService } from "./emergency-stop.service.js";
import { eventBus } from "./event-bus.js";

function toActor(actor: AuthenticatedActor): Actor {
  return { actorType: actor.type, actorId: actor.id };
}

/** Stage-event history filtered to the real, linear-progress stages — AWAITING_HUMAN is a pause marker, never itself "completed work" (see resumeFromAwaitingHuman's own comment). */
async function completedLinearStages(cycleId: string): Promise<CycleStage[]> {
  const events = await operatingCycleRepository.listCompletedStages(cycleId);
  return events.map((e) => e.stage).filter((s): s is CycleStage => isCycleStage(s) && s !== "AWAITING_HUMAN");
}

export interface StartCycleParams {
  definition: OperatingCycleDefinition;
  startedBy: AuthenticatedActor;
  kind?: CycleKind;
  scheduledFor?: Date | null;
  idempotencyKey?: string | null;
}

export interface AdvanceStageResult {
  cycle: OperatingCycle;
  stageEvent: CycleStageEvent;
}

/**
 * The bounded, explicitly-invoked cycle engine (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §17) — not a cron daemon, not a background loop. Every function here
 * advances exactly one `OperatingCycle` by exactly one stage (or one
 * status transition), records the fact via a `CycleStageEvent`, and
 * returns — something external (an API call, a demo script, a test)
 * must call again to make further progress. Mirrors
 * `research-cycle.service.ts`/`decision-cycle.service.ts`'s own
 * "nothing runs unattended" discipline at the company level.
 */
export const schedulerService = {
  /** Second call with the same idempotencyKey returns the existing cycle unchanged (§41) — mirrors claimExtractionService's own idempotent-return precedent. */
  async startCycle(params: StartCycleParams): Promise<OperatingCycle> {
    if (params.idempotencyKey) {
      const existing = await operatingCycleRepository.findByIdempotencyKey(params.idempotencyKey);
      if (existing) return existing;
    }

    const kind = params.kind ?? "MANUAL";
    if (!isCycleKind(kind)) {
      throw new ValidationError(`Invalid OperatingCycle kind: ${kind}`);
    }
    if (!isRiskLevel(params.definition.riskLevel)) {
      throw new ValidationError(`Invalid OperatingCycle risk level: ${params.definition.riskLevel}`);
    }
    if (!params.definition.objective.trim() || !params.definition.scope.trim() || !params.definition.owner.trim()) {
      throw new ValidationError("An OperatingCycle requires a non-empty objective, scope, and owner.");
    }
    if (params.definition.maxCostUsd <= 0) {
      throw new ValidationError("An OperatingCycle requires a positive maxCostUsd budget.");
    }

    const scheduledFor = params.scheduledFor ?? null;
    const startsImmediately = !scheduledFor || scheduledFor.getTime() <= Date.now();
    const status: CycleStatus = startsImmediately ? "RUNNING" : "SCHEDULED";

    const cycle = await operatingCycleRepository.create({
      objective: params.definition.objective,
      scope: params.definition.scope,
      status,
      stage: "CREATED",
      kind,
      maxCostUsd: params.definition.maxCostUsd,
      riskLevel: params.definition.riskLevel,
      deadline: params.definition.deadline,
      owner: params.definition.owner,
      idempotencyKey: params.idempotencyKey ?? null,
      startedByIdentityId: params.startedBy.identityId,
      scheduledFor,
      startedAt: startsImmediately ? new Date() : null,
    });

    const createdEvent = await operatingCycleRepository.createStageEvent({ cycleId: cycle.id, stage: "CREATED" });
    await operatingCycleRepository.completeStageEvent(createdEvent.id, `Cycle created (${kind}), objective: ${params.definition.objective}`);

    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: "OPERATING_CYCLE_CREATED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      metadata: { kind, status, scope: params.definition.scope },
    });
    await eventBus.publish({ type: "OPERATING_CYCLE_STAGE_ADVANCED", payload: { cycleId: cycle.id, stage: "CREATED", status } });

    return cycle;
  },

  /** A SCHEDULED cycle whose scheduledFor has arrived (or a human wants to start it early) — flips status only; stage stays CREATED for the first real advanceStage call to move forward. */
  async beginScheduledCycle(cycleId: string): Promise<OperatingCycle> {
    const cycle = await operatingCycleRepository.getOrThrow(cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "RUNNING");
    return operatingCycleRepository.update(cycle.id, { status: "RUNNING", startedAt: new Date() });
  },

  /**
   * Advances a RUNNING cycle to the next stage in the fixed, linear
   * CYCLE_STAGES order (docs/M9_ARCHITECTURE_PROPOSAL.md §15), or to an
   * explicit `targetStage` for the one real branch point the linear
   * array can't express on its own: DECIDING legally leads to EITHER
   * AWAITING_HUMAN or EXECUTING (`CYCLE_STAGE_TRANSITIONS.DECIDING`),
   * but array-adjacency alone always resolves to AWAITING_HUMAN (the
   * literal next element) — a caller that has already confirmed a
   * human decided (e.g. controlPlaneService.runNextStage re-entering
   * DECIDING after resumeFromAwaitingHuman) passes `targetStage:
   * "EXECUTING"` to take the other legal branch. Omitted, this is
   * unchanged: the array-adjacent stage, exactly as before. The caller
   * is responsible for having actually done stage X's real work before
   * calling this — `summary` records what happened; this function only
   * performs the bookkeeping and legality check, per controlPlaneService's
   * own "coordinates, never blindly executes" boundary (§14). Emergency
   * Stop is checked at exactly this one mechanical choke point for the
   * move into EXECUTING (§46, §57) — fails closed.
   */
  async advanceStage(params: { cycleId: string; actor: AuthenticatedActor; summary?: string | null; targetStage?: CycleStage }): Promise<AdvanceStageResult> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (cycle.status !== "RUNNING") {
      throw new ValidationError(`OperatingCycle ${cycle.id} is not RUNNING (status: ${cycle.status}) — cannot advance its stage.`);
    }
    if (!isCycleStage(cycle.stage)) {
      throw new ValidationError(`Corrupt stored stage on OperatingCycle ${cycle.id}: ${cycle.stage}`);
    }

    // Cost control's own rollup check (docs/M9_ARCHITECTURE_PROPOSAL.md §50) — sits ABOVE the per-cycle
    // maxCostUsd ceiling, checked once per stage-advance; the cycle stops rather than proceeding on breach.
    const budgetCheck = await companyBudgetService.assertNotExceeded();
    if (budgetCheck.exceeded) {
      const stopped = await this.stopCycle({ cycleId: cycle.id, reason: `COMPANY_BUDGET_EXCEEDED: ${budgetCheck.reasoning}` });
      const openEvent = (await operatingCycleRepository.findOpenStageEvent(cycle.id, cycle.stage)) ?? (await operatingCycleRepository.createStageEvent({ cycleId: cycle.id, stage: cycle.stage }));
      return { cycle: stopped, stageEvent: openEvent };
    }

    const currentIndex = CYCLE_STAGES.indexOf(cycle.stage);
    const nextStage = params.targetStage ?? CYCLE_STAGES[currentIndex + 1];
    if (!nextStage) {
      throw new ValidationError(`OperatingCycle ${cycle.id} is already at its final stage (${cycle.stage}).`);
    }
    assertTransition("OperatingCycle.stage", CYCLE_STAGE_TRANSITIONS, cycle.stage, nextStage);

    if (nextStage === "EXECUTING") {
      await emergencyStopService.assertNotActive();
    }

    const openEvent = await operatingCycleRepository.findOpenStageEvent(cycle.id, cycle.stage);
    if (openEvent) {
      await operatingCycleRepository.completeStageEvent(openEvent.id, params.summary ?? null);
    }
    const stageEvent = await operatingCycleRepository.createStageEvent({ cycleId: cycle.id, stage: nextStage });

    const isFinal = nextStage === "COMPLETED";
    const updated = await operatingCycleRepository.update(cycle.id, {
      stage: nextStage,
      status: isFinal ? "COMPLETED" : cycle.status,
      completedAt: isFinal ? new Date() : undefined,
    });

    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_STAGE_ADVANCED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      metadata: { fromStage: cycle.stage, toStage: nextStage },
    });
    await eventBus.publish({ type: "OPERATING_CYCLE_STAGE_ADVANCED", payload: { cycleId: cycle.id, fromStage: cycle.stage, toStage: nextStage, status: updated.status } });

    return { cycle: updated, stageEvent };
  },

  /**
   * The current stage's own work determined a human decision is
   * needed before it can complete — its CycleStageEvent stays OPEN
   * (never marked completed: its real work isn't finished), and a
   * fresh AWAITING_HUMAN event opens alongside it. This is what makes
   * `resumeFromAwaitingHuman` re-enter exactly the requesting stage,
   * never skip past it (§15's own definition of "returns to the stage
   * that requested it").
   */
  async routeToAwaitingHuman(params: { cycleId: string; reason: string }): Promise<OperatingCycle> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status) || !isCycleStage(cycle.stage)) {
      throw new ValidationError(`Corrupt stored state on OperatingCycle ${cycle.id}.`);
    }
    assertTransition("OperatingCycle.stage", CYCLE_STAGE_TRANSITIONS, cycle.stage, "AWAITING_HUMAN");
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "AWAITING_HUMAN");

    await operatingCycleRepository.createStageEvent({ cycleId: cycle.id, stage: "AWAITING_HUMAN", summary: params.reason });
    const updated = await operatingCycleRepository.update(cycle.id, { stage: "AWAITING_HUMAN", status: "AWAITING_HUMAN" });

    await auditService.record({
      actorType: "SYSTEM",
      actorId: "scheduler",
      action: "OPERATING_CYCLE_AWAITING_HUMAN",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: params.reason,
      metadata: { requestingStage: cycle.stage },
    });
    await eventBus.publish({ type: "OPERATING_CYCLE_STAGE_ADVANCED", payload: { cycleId: cycle.id, fromStage: cycle.stage, toStage: "AWAITING_HUMAN", status: "AWAITING_HUMAN" } });

    return updated;
  },

  /** A human has decided — re-enters exactly the stage that requested review (never CREATED, never skipping ahead), per resolveResumeStage's own history-based rule. */
  async resumeFromAwaitingHuman(params: { cycleId: string; actor: AuthenticatedActor; decisionSummary: string }): Promise<AdvanceStageResult> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (cycle.status !== "AWAITING_HUMAN") {
      throw new ValidationError(`OperatingCycle ${cycle.id} is not AWAITING_HUMAN (status: ${cycle.status}).`);
    }

    const openEvent = await operatingCycleRepository.findOpenStageEvent(cycle.id, "AWAITING_HUMAN");
    if (openEvent) {
      await operatingCycleRepository.completeStageEvent(openEvent.id, params.decisionSummary);
    }

    const resumeStage = resolveResumeStage(await completedLinearStages(cycle.id));
    if (resumeStage === "EXECUTING") {
      await emergencyStopService.assertNotActive();
    }

    const stageEvent = await operatingCycleRepository.createStageEvent({ cycleId: cycle.id, stage: resumeStage, summary: `Resumed after human decision: ${params.decisionSummary}` });
    const isFinal = resumeStage === "COMPLETED";
    const updated = await operatingCycleRepository.update(cycle.id, {
      stage: resumeStage,
      status: isFinal ? "COMPLETED" : "RUNNING",
      completedAt: isFinal ? new Date() : undefined,
    });

    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_RESUMED_FROM_HUMAN",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      metadata: { resumeStage },
    });
    await eventBus.publish({ type: "OPERATING_CYCLE_STAGE_ADVANCED", payload: { cycleId: cycle.id, fromStage: "AWAITING_HUMAN", toStage: resumeStage, status: updated.status } });

    return { cycle: updated, stageEvent };
  },

  /** Deliberate human-initiated halt (Constitution §8) — the current stage's open event is left exactly as it is; resuming re-enters it and re-does its real work, never restarts at CREATED. */
  async pauseCycle(params: { cycleId: string; actor: AuthenticatedActor; reason: string }): Promise<OperatingCycle> {
    assertHumanActor(toActor(params.actor));
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "PAUSED");

    const updated = await operatingCycleRepository.update(cycle.id, { status: "PAUSED" });
    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_PAUSED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: params.reason,
    });
    return updated;
  },

  async resumeCycle(params: { cycleId: string; actor: AuthenticatedActor }): Promise<OperatingCycle> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "RUNNING");

    const updated = await operatingCycleRepository.update(cycle.id, { status: "RUNNING" });
    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_RESUMED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      metadata: { stage: cycle.stage },
    });
    return updated;
  },

  /** Human-actor-gated (§17) — a deliberate stop, distinct from STOPPED (budget exhaustion, §37). */
  async cancelCycle(params: { cycleId: string; actor: AuthenticatedActor; reason: string }): Promise<OperatingCycle> {
    assertHumanActor(toActor(params.actor));
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "CANCELLED");

    const updated = await operatingCycleRepository.update(cycle.id, { status: "CANCELLED", stoppedReason: params.reason, completedAt: new Date() });
    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_CANCELLED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: params.reason,
    });
    return updated;
  },

  /** Budget exhaustion (§37) — a non-error, "stops as a matter of course" outcome; every row already committed stays intact. */
  async stopCycle(params: { cycleId: string; reason: string }): Promise<OperatingCycle> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "STOPPED");

    const updated = await operatingCycleRepository.update(cycle.id, { status: "STOPPED", stoppedReason: params.reason, completedAt: new Date() });
    await auditService.record({
      actorType: "SYSTEM",
      actorId: "scheduler",
      action: "OPERATING_CYCLE_STOPPED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: params.reason,
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §35 — budget exhaustion is one of the brief's own named alert sources.
    await alertService.raise({ alertType: "BUDGET_EXHAUSTED", severity: "WARNING", resourceType: "OPERATING_CYCLE", resourceId: cycle.id, message: `OperatingCycle stopped: ${params.reason}` });
    return updated;
  },

  /** An actual failure (§37) — distinct from STOPPED; the only status retryCycle will act on. */
  async failCycle(params: { cycleId: string; reason: string }): Promise<OperatingCycle> {
    const cycle = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (!isCycleStatus(cycle.status)) throw new ValidationError(`Corrupt stored status on OperatingCycle ${cycle.id}: ${cycle.status}`);
    assertTransition("OperatingCycle.status", CYCLE_STATUS_TRANSITIONS, cycle.status, "FAILED");

    const updated = await operatingCycleRepository.update(cycle.id, { status: "FAILED", stoppedReason: params.reason, completedAt: new Date() });
    await auditService.record({
      actorType: "SYSTEM",
      actorId: "scheduler",
      action: "OPERATING_CYCLE_FAILED",
      resourceType: "OPERATING_CYCLE",
      resourceId: cycle.id,
      result: "FAILURE",
      reason: params.reason,
    });
    return updated;
  },

  /**
   * A FAILED cycle's fresh continuation (§17, §37) — never mutates the
   * failed row (mirrors `Deployment.rolledBackFromId`'s own append-
   * only-retry precedent, M7). Resumes at the stage after the last one
   * that fully completed, read from CycleStageEvent history — a stage
   * that already committed real writes is never re-run.
   */
  async retryCycle(params: { cycleId: string; actor: AuthenticatedActor }): Promise<AdvanceStageResult> {
    const failed = await operatingCycleRepository.getOrThrow(params.cycleId);
    if (failed.status !== "FAILED") {
      throw new ValidationError(`OperatingCycle ${failed.id} is not FAILED (status: ${failed.status}) — cannot retry.`);
    }

    const resumeStage = resolveResumeStage(await completedLinearStages(failed.id));
    if (resumeStage === "EXECUTING") {
      await emergencyStopService.assertNotActive();
    }

    const fresh = await operatingCycleRepository.create({
      objective: failed.objective,
      scope: failed.scope,
      status: "RUNNING",
      stage: resumeStage,
      kind: "RETRIED",
      maxCostUsd: failed.maxCostUsd,
      riskLevel: failed.riskLevel,
      deadline: failed.deadline,
      owner: failed.owner,
      retriedFromCycleId: failed.id,
      startedByIdentityId: params.actor.identityId,
      startedAt: new Date(),
    });
    const stageEvent = await operatingCycleRepository.createStageEvent({
      cycleId: fresh.id,
      stage: resumeStage,
      summary: `Retried from failed cycle ${failed.id} (failure reason: ${failed.stoppedReason ?? "unknown"}), resuming at ${resumeStage}.`,
    });

    await auditService.record({
      actorType: params.actor.type,
      actorId: params.actor.id,
      action: "OPERATING_CYCLE_RETRIED",
      resourceType: "OPERATING_CYCLE",
      resourceId: fresh.id,
      result: "SUCCESS",
      metadata: { retriedFromCycleId: failed.id, resumeStage },
    });
    await eventBus.publish({ type: "OPERATING_CYCLE_STAGE_ADVANCED", payload: { cycleId: fresh.id, fromStage: null, toStage: resumeStage, status: "RUNNING", retriedFromCycleId: failed.id } });

    return { cycle: fresh, stageEvent };
  },

  getCycle(cycleId: string): Promise<OperatingCycle> {
    return operatingCycleRepository.getOrThrow(cycleId);
  },

  listStageHistory(cycleId: string): Promise<CycleStageEvent[]> {
    return operatingCycleRepository.listStageEvents(cycleId);
  },
};

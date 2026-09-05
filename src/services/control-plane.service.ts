import type { CycleStageEvent, EmergencyStop, OperatingCycle } from "@prisma/client";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { operatingCycleRepository, type ListOperatingCyclesFilter } from "../db/repositories/operating-cycle.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import type { CompanyStateDimensions } from "../domain/company-state/company-state.types.js";
import { PORTFOLIO_BUCKETS } from "../domain/company-state/company-state.types.js";
import type { MetricResult } from "../domain/shared/metric-result.js";
import { approvalService } from "./approval.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { chairmanService } from "./chairman.service.js";
import { companyStateService } from "./company-state.service.js";
import { companyTimelineService, type TimelineEntry } from "./company-timeline.service.js";
import { emergencyStopService } from "./emergency-stop.service.js";
import { portfolioControlService, type PortfolioOverview } from "./portfolio-control.service.js";
import { predictionOutcomeService } from "./prediction-outcome.service.js";
import { schedulerService, type AdvanceStageResult, type StartCycleParams } from "./scheduler.service.js";

function formatMetric(result: MetricResult): string {
  if (result.status === "COMPUTED") return result.value.toFixed(2);
  if (result.status === "INSUFFICIENT_DATA") return `INSUFFICIENT_DATA (${result.reason})`;
  return "UNKNOWN";
}

export interface ControlPlaneStatus {
  activeCycles: OperatingCycle[];
  emergencyStopActive: boolean;
  companyState: CompanyStateDimensions;
}

/**
 * The Company Control Plane (docs/M9_ARCHITECTURE_PROPOSAL.md §14) —
 * a coordinator, never an executor, matching the same boundary M7's
 * launch orchestrator and M8's business-intelligence orchestrator
 * already draw. Exactly three kinds of methods: status reads (pure
 * aggregation, zero writes), cycle coordination (thin delegation to
 * `schedulerService`, which owns the actual state machine), and
 * emergency stop (thin delegation to `emergencyStopService`). Holds no
 * new Guardian permission because it never performs an action a
 * Guardian permission would gate — every consequential step it
 * triggers still goes through the same PLAN/APPROVE/EXECUTE or
 * CEO/Chairman/human chain that step already required before M9.
 */
export const controlPlaneService = {
  async getStatus(): Promise<ControlPlaneStatus> {
    const [activeCycles, emergencyStopActive, companyState] = await Promise.all([
      operatingCycleRepository.listActive(),
      emergencyStopService.isActive(),
      companyStateService.getState(),
    ]);
    return { activeCycles, emergencyStopActive, companyState };
  },

  getCompanyState(): Promise<CompanyStateDimensions> {
    return companyStateService.getState();
  },

  getPortfolio(): Promise<PortfolioOverview> {
    return portfolioControlService.overview();
  },

  getTimeline(since?: Date, limit?: number): Promise<TimelineEntry[]> {
    return companyTimelineService.getTimeline(since, limit);
  },

  getCycle(cycleId: string): Promise<OperatingCycle> {
    return schedulerService.getCycle(cycleId);
  },

  listCycles(filter?: ListOperatingCyclesFilter): Promise<OperatingCycle[]> {
    return operatingCycleRepository.list(filter);
  },

  getCycleStageHistory(cycleId: string): Promise<CycleStageEvent[]> {
    return schedulerService.listStageHistory(cycleId);
  },

  startCycle(params: StartCycleParams): Promise<OperatingCycle> {
    return schedulerService.startCycle(params);
  },

  beginScheduledCycle(cycleId: string): Promise<OperatingCycle> {
    return schedulerService.beginScheduledCycle(cycleId);
  },

  advanceCycle(params: { cycleId: string; actor: AuthenticatedActor; summary?: string | null }): Promise<AdvanceStageResult> {
    return schedulerService.advanceStage(params);
  },

  routeToAwaitingHuman(params: { cycleId: string; reason: string }): Promise<OperatingCycle> {
    return schedulerService.routeToAwaitingHuman(params);
  },

  resumeFromAwaitingHuman(params: { cycleId: string; actor: AuthenticatedActor; decisionSummary: string }): Promise<AdvanceStageResult> {
    return schedulerService.resumeFromAwaitingHuman(params);
  },

  pauseCycle(params: { cycleId: string; actor: AuthenticatedActor; reason: string }): Promise<OperatingCycle> {
    return schedulerService.pauseCycle(params);
  },

  resumeCycle(params: { cycleId: string; actor: AuthenticatedActor }): Promise<OperatingCycle> {
    return schedulerService.resumeCycle(params);
  },

  cancelCycle(params: { cycleId: string; actor: AuthenticatedActor; reason: string }): Promise<OperatingCycle> {
    return schedulerService.cancelCycle(params);
  },

  retryCycle(params: { cycleId: string; actor: AuthenticatedActor }): Promise<AdvanceStageResult> {
    return schedulerService.retryCycle(params);
  },

  activateEmergencyStop(params: { actor: AuthenticatedActor; reason: string }): Promise<EmergencyStop> {
    return emergencyStopService.activate(params);
  },

  resumeFromEmergencyStop(params: { actor: AuthenticatedActor }): Promise<EmergencyStop> {
    return emergencyStopService.resume(params);
  },

  getEmergencyStopStatus(): Promise<EmergencyStop | null> {
    return emergencyStopService.getCurrent();
  },

  /**
   * Does the real work for the cycle's CURRENT stage, then advances —
   * the one place that assembles the pieces §14 says this service may
   * only COORDINATE, never itself execute: every call below is to an
   * existing, unmodified orchestrator (companyStateService,
   * portfolioControlService, ceoReasoningService, chairmanService,
   * predictionOutcomeService, approvalService). Never calls a
   * provider, never calls an EXECUTE step directly — EXECUTING's own
   * "work" is bookkeeping only, since M9 adds zero new execution
   * paths (§32's own closing line): the actual EXECUTE already
   * happened, or will happen, through the existing M6/M7 services a
   * human calls directly after approving. One call advances exactly
   * one stage, per docs/M9_ARCHITECTURE_PROPOSAL.md §17 — the caller
   * loops if it wants the whole cycle to progress.
   */
  async runNextStage(params: { cycleId: string; actor: AuthenticatedActor; ceoAgentId?: string }): Promise<OperatingCycle> {
    const cycle = await schedulerService.getCycle(params.cycleId);

    switch (cycle.stage) {
      case "CREATED":
        return (await schedulerService.advanceStage({ cycleId: params.cycleId, actor: params.actor, summary: `Objective: ${cycle.objective}` })).cycle;

      case "PLANNING":
        return (await schedulerService.advanceStage({ cycleId: params.cycleId, actor: params.actor, summary: `Scope: ${cycle.scope}` })).cycle;

      case "RESEARCHING": {
        const state = await companyStateService.getState();
        return (
          await schedulerService.advanceStage({
            cycleId: params.cycleId,
            actor: params.actor,
            summary: `Evidence quality across the portfolio: ${formatMetric(state.evidenceQuality)}. Decision backlog: ${state.decisionBacklog}.`,
          })
        ).cycle;
      }

      case "ANALYZING": {
        const [state, portfolio] = await Promise.all([companyStateService.getState(), portfolioControlService.overview()]);
        const bucketCounts = PORTFOLIO_BUCKETS.map((bucket) => `${bucket}=${portfolio[bucket].length}`).join(", ");
        return (
          await schedulerService.advanceStage({
            cycleId: params.cycleId,
            actor: params.actor,
            summary: `Portfolio size ${state.portfolioSize}, health ${formatMetric(state.portfolioHealth)}, risk ${formatMetric(state.risk)}. Buckets: ${bucketCounts}.`,
          })
        ).cycle;
      }

      case "DECIDING": {
        // DECIDING is a real branch point (CYCLE_STAGE_TRANSITIONS.DECIDING: ["AWAITING_HUMAN", "EXECUTING"]) —
        // a re-entry after resumeFromAwaitingHuman lands back on DECIDING itself (its own CycleStageEvent was
        // left open specifically so a redo re-enters it, per routeToAwaitingHuman's own doc comment). For every
        // OTHER stage that's exactly right (redo the stage's real work); for DECIDING it is not — the human's
        // decision, once recorded on the CompanyRecommendation this stage produced, IS the missing piece, and
        // creating a second recommendation + re-requesting review would loop DECIDING<->AWAITING_HUMAN forever,
        // never reaching EXECUTING (a real bug this build caught while writing tests/unit/m9-operating-cycle.test.ts:
        // schedulerService.advanceStage's array-adjacency default can only ever move DECIDING -> AWAITING_HUMAN,
        // so the "already decided" case must ask for the other legal branch explicitly via targetStage).
        const existing = await companyRecommendationRepository.listForCycle(params.cycleId);
        const alreadyDecided = existing.find((r) => r.humanDecision !== null);
        if (alreadyDecided) {
          return (
            await schedulerService.advanceStage({
              cycleId: params.cycleId,
              actor: params.actor,
              summary: `Human decided ${alreadyDecided.humanDecision} on CompanyRecommendation ${alreadyDecided.id} (${alreadyDecided.action}) — proceeding to EXECUTING.`,
              targetStage: "EXECUTING",
            })
          ).cycle;
        }

        if (!params.ceoAgentId) {
          throw new Error("runNextStage: DECIDING requires ceoAgentId.");
        }
        const ceoOutcome = await ceoReasoningService.recommendCompanyAction({ agentId: params.ceoAgentId, startedBy: params.actor, operatingCycleId: params.cycleId });
        if (ceoOutcome.status !== "COMPLETED") {
          return schedulerService.routeToAwaitingHuman({ cycleId: params.cycleId, reason: `CEO reasoning did not complete (status: ${ceoOutcome.status}) — a human must review directly.` });
        }
        const chairmanResult = await chairmanService.reviewCompanyAction({ companyRecommendationId: ceoOutcome.result.recommendation.id, reviewedBy: params.actor });
        return schedulerService.routeToAwaitingHuman({
          cycleId: params.cycleId,
          reason: `CEO recommended ${ceoOutcome.result.recommendation.action} (confidence ${ceoOutcome.result.recommendation.confidence.toFixed(2)}); Chairman ${chairmanResult.decision.decision} — awaiting the Human Owner's decision.`,
        });
      }

      case "EXECUTING":
        // M9 adds zero new execution paths (§32) — the actual EXECUTE already happened via the existing,
        // human-invoked M6/M7 services once the human approved the underlying recommendation.
        return (await schedulerService.advanceStage({ cycleId: params.cycleId, actor: params.actor, summary: "No new execution path — EXECUTE already handled by the existing, human-invoked services." })).cycle;

      case "OBSERVING": {
        const [predictionSweep, expiredCount] = await Promise.all([predictionOutcomeService.resolveAllDue(), approvalService.expireOverdue()]);
        return (
          await schedulerService.advanceStage({
            cycleId: params.cycleId,
            actor: params.actor,
            summary: `Resolved ${predictionSweep.resolved.length} due prediction(s) (${predictionSweep.skipped} skipped, no observed value yet). Expired ${expiredCount} overdue PENDING approval(s).`,
          })
        ).cycle;
      }

      case "LEARNING":
        // LearningRecord creation is already automatic inside predictionOutcomeService.resolve (§30) —
        // this stage is a bookkeeping close, not a second write path.
        return (await schedulerService.advanceStage({ cycleId: params.cycleId, actor: params.actor, summary: "Learning records (if any) were already created automatically during OBSERVING." })).cycle;

      case "AWAITING_HUMAN":
        throw new Error(`runNextStage: cycle ${cycle.id} is AWAITING_HUMAN — call resumeFromAwaitingHuman once a human has decided, not runNextStage.`);

      case "COMPLETED":
      default:
        return cycle;
    }
  },
};

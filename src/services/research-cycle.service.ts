import type { Opportunity, Problem, ResearchCycle } from "@prisma/client";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { isResearchCycleStatus, RESEARCH_CYCLE_STATUS_TRANSITIONS, type ResearchCycleStatus } from "../domain/research-cycle/research-cycle.types.js";
import { researchCycleRepository, type UpdateResearchCycleInput } from "../db/repositories/research-cycle.repository.js";
import { auditService } from "./audit.service.js";
import { authorizationService } from "./authorization.service.js";
import { competitorAnalystService } from "./competitor-analyst.service.js";
import { eventBus } from "./event-bus.js";
import { marketAnalystService } from "./market-analyst.service.js";
import { opportunityAnalystService } from "./opportunity-analyst.service.js";
import { problemAnalystService } from "./problem-analyst.service.js";
import { researchAgentService } from "./research-agent.service.js";
import { researchQueueService } from "./research-queue.service.js";
import { signalClusteringService } from "./signal-clustering.service.js";
import { signalService } from "./signal.service.js";

export interface ResearchCycleBudget {
  maxDurationMs: number;
  maxSignals: number;
  maxToolCalls: number;
  maxModelCalls: number;
  maxCostUsd: number;
}

/** Sized to comfortably cover one cold-start cycle (a handful of
 *  clusters/problems) with margin, not derived from an SLA — a
 *  founder-revisable number like every other budget in this codebase
 *  (docs/M3_ARCHITECTURE_PROPOSAL.md §20; docs/DECISIONS.md #18). */
export const DEFAULT_RESEARCH_CYCLE_BUDGET: ResearchCycleBudget = {
  maxDurationMs: 120_000,
  maxSignals: 30,
  maxToolCalls: 20,
  maxModelCalls: 20,
  maxCostUsd: 5,
};

export interface RunResearchCycleParams {
  objective: string;
  researchAgentId: string;
  problemAnalystAgentId: string;
  competitorAnalystAgentId: string;
  marketAnalystAgentId: string;
  opportunityAnalystAgentId: string;
  startedBy: AuthenticatedActor;
  budgetOverrides?: Partial<ResearchCycleBudget>;
}

export interface ResearchCycleSummary {
  cycle: ResearchCycle;
  signalsCollected: number;
  clustersTouched: number;
  problemsExtracted: Problem[];
  opportunitiesGenerated: Opportunity[];
}

/**
 * The CEO orchestration boundary (M3 brief Part 26; docs/M3_ARCHITECTURE_PROPOSAL.md
 * §14, §16, §20): deterministic CODE, never a model call of its own —
 * "build the orchestration foundation, not the full autonomous CEO."
 * Drives the fixed pipeline (signal collection -> clustering -> problem
 * extraction -> competitor/market analysis -> opportunity generation
 * -> research queue) under one cycle-level budget layered above each
 * agent's own execution budget, and never bypasses Guardian,
 * permissions, the approval system, or the Human Owner — every step it
 * triggers goes through the same authenticated, authorized, audited
 * service calls any other caller would use; it holds no elevated
 * privilege itself.
 */
export const researchCycleService = {
  async run(params: RunResearchCycleParams): Promise<ResearchCycleSummary> {
    const budget: ResearchCycleBudget = { ...DEFAULT_RESEARCH_CYCLE_BUDGET, ...params.budgetOverrides };

    let cycle = await researchCycleRepository.create({
      objective: params.objective,
      startedByIdentityId: params.startedBy.identityId,
      maxDurationMs: budget.maxDurationMs,
      maxSignals: budget.maxSignals,
      maxToolCalls: budget.maxToolCalls,
      maxModelCalls: budget.maxModelCalls,
      maxCostUsd: budget.maxCostUsd,
    });
    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: "START_RESEARCH_CYCLE",
      resourceType: "RESEARCH_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "RESEARCH_CYCLE_STARTED", payload: { researchCycleId: cycle.id, objective: params.objective } });

    // The one real AWAITING_HUMAN producer in M3 (docs/M3_ARCHITECTURE_PROPOSAL.md
    // §16): the cycle can't even start if its Research Agent currently
    // lacks the grant it needs — surfaced the same queue-shaped way as
    // every other decision, not buried in an error log.
    const authDecision = await authorizationService.authorize({ agentId: params.researchAgentId, action: "READ_WEB" });
    if (authDecision.decision !== "ALLOWED") {
      cycle = await transitionCycle(cycle, "AWAITING_HUMAN");
      return { cycle, signalsCollected: 0, clustersTouched: 0, problemsExtracted: [], opportunitiesGenerated: [] };
    }

    // Part 30: resolve the objective from the highest-priority queue
    // item if one is waiting ("resolve the single uncertainty most
    // likely to change the decision"), else the caller's cold-start
    // objective — resolved BEFORE the RUNNING transition so the
    // persisted `objective` column always reflects what the cycle
    // actually researched, never a stale request-time value
    // (Constitution §29, Transparency).
    const queueItem = await researchQueueService.next();
    const objective = queueItem?.reason ?? params.objective;
    if (queueItem) await researchQueueService.markInProgress(queueItem.id);

    cycle = await transitionCycle(cycle, "RUNNING", { startedAt: new Date(), objective });
    const startedAt = cycle.startedAt ?? new Date();
    const usage = { signals: 0, toolCalls: 0, modelCalls: 0 };

    const withinBudget = (): boolean =>
      Date.now() - startedAt.getTime() <= budget.maxDurationMs &&
      usage.signals <= budget.maxSignals &&
      usage.toolCalls <= budget.maxToolCalls &&
      usage.modelCalls <= budget.maxModelCalls;

    let stoppedReason: string | null = null;
    const touchedClusterIds = new Set<string>();
    const problemsExtracted: Problem[] = [];
    const opportunitiesGenerated: Opportunity[] = [];

    const researchOutcome = await researchAgentService.run({ agentId: params.researchAgentId, objective, startedBy: params.startedBy });
    usage.toolCalls += researchOutcome.execution.toolCallCount;
    usage.modelCalls += researchOutcome.execution.modelCallCount;

    if (researchOutcome.status === "COMPLETED") {
      usage.signals += researchOutcome.result.signalsIngested;
      for (const signalId of researchOutcome.result.signalIds) {
        const signal = await signalService.getOrThrow(signalId);
        if (signal.status !== "PROCESSED") continue; // never cluster a duplicate/rejected signal
        const cluster = await signalClusteringService.assign(signal.id);
        touchedClusterIds.add(cluster.id);
      }
    }

    if (!withinBudget()) {
      stoppedReason = "Cycle exceeded its budget after signal collection.";
    }

    if (!stoppedReason) {
      for (const clusterId of touchedClusterIds) {
        if (!withinBudget()) {
          stoppedReason = "Cycle exceeded its budget during problem extraction.";
          break;
        }
        const outcome = await problemAnalystService.run({ agentId: params.problemAnalystAgentId, clusterId, startedBy: params.startedBy });
        usage.modelCalls += outcome.execution.modelCallCount;
        if (outcome.status === "COMPLETED") problemsExtracted.push(outcome.result.problem);
      }
    }

    if (!stoppedReason) {
      for (const problem of problemsExtracted) {
        if (problem.status !== "CANDIDATE") continue; // INSUFFICIENT_EVIDENCE never proceeds (Part 43)
        if (!withinBudget()) {
          stoppedReason = "Cycle exceeded its budget during opportunity generation.";
          break;
        }

        const competitorOutcome = await competitorAnalystService.run({ agentId: params.competitorAnalystAgentId, problemId: problem.id, startedBy: params.startedBy });
        usage.toolCalls += competitorOutcome.execution.toolCallCount;
        usage.modelCalls += competitorOutcome.execution.modelCallCount;

        const marketOutcome = await marketAnalystService.run({ agentId: params.marketAnalystAgentId, problemId: problem.id, startedBy: params.startedBy });
        usage.modelCalls += marketOutcome.execution.modelCallCount;
        if (marketOutcome.status !== "COMPLETED") continue;

        const opportunityOutcome = await opportunityAnalystService.run({
          agentId: params.opportunityAnalystAgentId,
          problemId: problem.id,
          marketAnalysis: marketOutcome.result,
          startedBy: params.startedBy,
        });
        usage.modelCalls += opportunityOutcome.execution.modelCallCount;
        if (opportunityOutcome.status === "COMPLETED") {
          opportunitiesGenerated.push(opportunityOutcome.result.opportunity);
          await researchQueueService.populateForOpportunity(opportunityOutcome.result.opportunity.id);
        }
      }
    }

    if (queueItem) await researchQueueService.markDone(queueItem.id);

    cycle = await researchCycleRepository.update(cycle.id, {
      signalsCollected: usage.signals,
      toolCallCount: usage.toolCalls,
      modelCallCount: usage.modelCalls,
      opportunitiesGenerated: opportunitiesGenerated.length,
    });
    // Part 38: STOP, AUDIT, SAVE PARTIAL RESULTS — every row committed
    // above stays exactly as it is; nothing is rolled back.
    cycle = await transitionCycle(cycle, stoppedReason ? "STOPPED" : "COMPLETED", { completedAt: new Date(), stoppedReason });

    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: stoppedReason ? "RESEARCH_CYCLE_STOPPED" : "RESEARCH_CYCLE_COMPLETED",
      resourceType: "RESEARCH_CYCLE",
      resourceId: cycle.id,
      result: "SUCCESS",
      reason: stoppedReason,
      metadata: { signalsCollected: usage.signals, opportunitiesGenerated: opportunitiesGenerated.length },
    });
    await eventBus.publish({
      type: "RESEARCH_CYCLE_COMPLETED",
      payload: { researchCycleId: cycle.id, status: cycle.status, opportunitiesGenerated: opportunitiesGenerated.length },
    });

    return { cycle, signalsCollected: usage.signals, clustersTouched: touchedClusterIds.size, problemsExtracted, opportunitiesGenerated };
  },
};

async function transitionCycle(cycle: ResearchCycle, toStatus: ResearchCycleStatus, extra: UpdateResearchCycleInput = {}): Promise<ResearchCycle> {
  if (!isResearchCycleStatus(cycle.status)) {
    throw new ValidationError(`Corrupt stored status on research cycle ${cycle.id}: ${cycle.status}`);
  }
  assertTransition("ResearchCycle", RESEARCH_CYCLE_STATUS_TRANSITIONS, cycle.status, toStatus);
  return researchCycleRepository.update(cycle.id, { status: toStatus, ...extra });
}

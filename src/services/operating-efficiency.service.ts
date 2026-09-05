import { agentExecutionRepository } from "../db/repositories/agent-execution.repository.js";
import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { decisionRecordRepository } from "../db/repositories/decision-record.repository.js";
import { launchReviewMemoRepository } from "../db/repositories/launch-review-memo.repository.js";
import { operatingCycleRepository } from "../db/repositories/operating-cycle.repository.js";
import { predictionOutcomeRepository } from "../db/repositories/prediction-outcome.repository.js";
import { productReviewMemoRepository } from "../db/repositories/product-review-memo.repository.js";
import { currentPeriod } from "../domain/shared/company-period.js";
import { founderDecisionQueueService } from "./founder-decision-queue.service.js";

function periodStart(period: string): Date {
  const [yearStr, weekStr] = period.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(firstThursday);
  firstMonday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7));
  firstMonday.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
  return firstMonday;
}

export interface OperatingEfficiencyMetrics {
  readonly period: string;
  readonly agentExecutionCount: number;
  readonly toolCallCount: number;
  readonly modelCallCount: number;
  readonly estimatedCostUsd: number;
  readonly failedExecutionCount: number;
  readonly retryCount: number;
  readonly avgCycleDurationMs: number | null;
  readonly completedCycleCount: number;
  readonly decisionsDecided: number;
  readonly decisionsPending: number;
  readonly safeAutomatedActionCount: number;
}

/**
 * `operatingEfficiencyService.getMetrics(period)` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §49) — a READ, nothing new to instrument: every number here already
 * exists on an `AgentExecution`/`OperatingCycle`/`PredictionOutcome`
 * row from an earlier milestone.
 */
export const operatingEfficiencyService = {
  async getMetrics(period: string = currentPeriod()): Promise<OperatingEfficiencyMetrics> {
    const since = periodStart(period);

    const [executions, allCycles, resolvedOutcomes, decisionQueue, decisionRecords, customerDiscoveryMemos, productReviewMemos, launchReviewMemos, businessReviewMemos] = await Promise.all([
      agentExecutionRepository.listCreatedSince(since),
      operatingCycleRepository.list(),
      predictionOutcomeRepository.listResolved(),
      founderDecisionQueueService.listPending(),
      decisionRecordRepository.list(),
      customerDiscoveryMemoRepository.list(),
      productReviewMemoRepository.list(),
      launchReviewMemoRepository.list(),
      businessReviewMemoRepository.list(),
    ]);

    // Decided-within-period, across every real decision source (docs/M9_ARCHITECTURE_PROPOSAL.md §19's own union) —
    // InvestmentMemo's own decision proxy is DecisionRecord.createdAt (§9's confirmed asymmetry); the other four
    // memo tables carry decidedAt directly.
    const decisionsDecided =
      decisionRecords.filter((r) => r.createdAt.getTime() >= since.getTime()).length +
      customerDiscoveryMemos.filter((m) => m.decidedAt && m.decidedAt.getTime() >= since.getTime()).length +
      productReviewMemos.filter((m) => m.decidedAt && m.decidedAt.getTime() >= since.getTime()).length +
      launchReviewMemos.filter((m) => m.decidedAt && m.decidedAt.getTime() >= since.getTime()).length +
      businessReviewMemos.filter((m) => m.decidedAt && m.decidedAt.getTime() >= since.getTime()).length;

    const cyclesInPeriod = allCycles.filter((c) => c.createdAt.getTime() >= since.getTime());
    const completedCycles = cyclesInPeriod.filter((c) => c.status === "COMPLETED" && c.startedAt && c.completedAt);
    const avgCycleDurationMs = completedCycles.length > 0 ? completedCycles.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.startedAt!.getTime()), 0) / completedCycles.length : null;

    const resolvedInPeriod = resolvedOutcomes.filter((o) => o.resolvedAt && o.resolvedAt.getTime() >= since.getTime());

    return {
      period,
      agentExecutionCount: executions.length,
      toolCallCount: executions.reduce((sum, e) => sum + e.toolCallCount, 0),
      modelCallCount: executions.reduce((sum, e) => sum + e.modelCallCount, 0),
      estimatedCostUsd: executions.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0),
      failedExecutionCount: executions.filter((e) => e.status === "FAILED").length,
      retryCount: executions.reduce((sum, e) => sum + e.retryCount, 0),
      avgCycleDurationMs,
      completedCycleCount: completedCycles.length,
      decisionsDecided,
      decisionsPending: decisionQueue.length,
      // resolveAllDue's own automatic resolutions (§28) — every write this milestone makes that required no human decision.
      safeAutomatedActionCount: resolvedInPeriod.length,
    };
  },
};

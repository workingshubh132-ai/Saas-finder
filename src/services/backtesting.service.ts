import type { BusinessHealth } from "@prisma/client";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { computeBusinessActionPriorityScore } from "../domain/decision/business-action.types.js";

export interface BacktestResult {
  asOfSnapshot: BusinessHealth | null;
  asOfPriorityScore: number | null;
  currentSnapshot: BusinessHealth | null;
  currentPriorityScore: number | null;
}

/**
 * Backtesting (docs/M8_ARCHITECTURE_PROPOSAL.md §38) — re-runs the
 * deterministic prioritization formula (§22) against BusinessHealth
 * snapshots filtered to `computedAt <= asOfDate`, compared against the
 * current snapshot, so a human can see "what would the CEO have
 * prioritized with what it knew then" against "what do we know now."
 * SCOPE, STATED PLAINLY: only the deterministic scoring layer is
 * replayed here — the underlying LLM reasoning call is not literally
 * re-invoked historically, since this codebase has no way to pin a
 * real historical model snapshot. Never overclaimed as a full decision
 * replay.
 */
export const backtestingService = {
  async evaluate(productId: string, asOfDate: Date): Promise<BacktestResult> {
    const history = await businessHealthRepository.listForProduct(productId);
    const asOfSnapshot = history.find((h) => h.computedAt.getTime() <= asOfDate.getTime()) ?? null;
    const currentSnapshot = history[0] ?? null;

    return {
      asOfSnapshot,
      asOfPriorityScore: asOfSnapshot ? computeBusinessActionPriorityScore(asOfSnapshot) : null,
      currentSnapshot,
      currentPriorityScore: currentSnapshot ? computeBusinessActionPriorityScore(currentSnapshot) : null,
    };
  },
};

import type { DecisionOutcome, LearningRecord } from "@prisma/client";
import { decisionOutcomeRepository } from "../db/repositories/decision-outcome.repository.js";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { ValidationError } from "../domain/shared/errors.js";

export interface RecordExpectationParams {
  decisionType: string;
  decisionResourceId: string;
  expectedMetricType?: string | null;
  expectedValue?: number | null;
}

export interface EvaluateOutcomeParams {
  decisionOutcomeId: string;
  actualValue: number;
  learningRecordId?: string | null;
  now?: Date;
}

export interface DecisionMemoryEntry {
  readonly outcome: DecisionOutcome;
  readonly learningRecord: LearningRecord | null;
}

/**
 * Decision memory (docs/M9_ARCHITECTURE_PROPOSAL.md §27) — "what did we
 * expect to happen" against "what actually happened," at the DECISION
 * level (as opposed to `predictionOutcomeService`'s own narrower
 * METRIC-level tracking, §28 — a structurally different, already-
 * existing mechanism, not reused here since a decision-level
 * expectation isn't always metric-shaped). Genuinely new — nothing in
 * M1-M8 records this pairing at the decision level. The
 * belief/reasoning/evidence half of "have we made this mistake
 * before" already lives on the relevant memo's own `content` JSON
 * (§26) and on `decisionCardService` (§20, current pending items) —
 * this service covers only the expected-vs-actual pairing DecisionOutcome
 * itself stores, not a re-derivation of the CEO/Chairman narrative.
 */
export const decisionMemoryService = {
  recordExpectation(params: RecordExpectationParams): Promise<DecisionOutcome> {
    return decisionOutcomeRepository.create(params);
  },

  async evaluateOutcome(params: EvaluateOutcomeParams): Promise<DecisionOutcome> {
    const outcome = await decisionOutcomeRepository.getOrThrow(params.decisionOutcomeId);
    if (outcome.actualValue !== null) {
      throw new ValidationError(`DecisionOutcome ${outcome.id} was already evaluated — a decision outcome is recorded exactly once.`);
    }
    return decisionOutcomeRepository.evaluate(outcome.id, params.actualValue, params.now ?? new Date(), params.learningRecordId ?? null);
  },

  async getHistory(decisionType: string, decisionResourceId: string): Promise<DecisionMemoryEntry[]> {
    const outcomes = await decisionOutcomeRepository.listForResource(decisionType, decisionResourceId);
    return Promise.all(
      outcomes.map(async (outcome) => ({
        outcome,
        learningRecord: outcome.learningRecordId ? await learningRecordRepository.findById(outcome.learningRecordId) : null,
      })),
    );
  },

  /** "Have we made this mistake before?" (docs/M9_ARCHITECTURE_PROPOSAL.md §27, M9 brief §15) — past decisions of the SAME kind that generated a real lesson. */
  async findSimilarPastDecisions(decisionType: string): Promise<DecisionMemoryEntry[]> {
    const outcomes = await decisionOutcomeRepository.listWithLearningRecordByType(decisionType);
    return Promise.all(
      outcomes.map(async (outcome) => ({
        outcome,
        learningRecord: outcome.learningRecordId ? await learningRecordRepository.findById(outcome.learningRecordId) : null,
      })),
    );
  },
};

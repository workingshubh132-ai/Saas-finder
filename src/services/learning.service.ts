import type { LearningRecord } from "@prisma/client";
import { businessReviewMemoRepository } from "../db/repositories/business-review-memo.repository.js";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { isLearningRootCause, type LearningRootCause } from "../domain/learning/learning-record.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { eventBus } from "./event-bus.js";

export interface RecordFromRejectedMemoParams {
  businessReviewMemoId: string;
  rootCause: LearningRootCause;
  lesson: string;
  suggestedProcessChange?: string | null;
}

/**
 * `learningService.recordFromFailure` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §30) — a thin wrapper creating a `LearningRecord` (M8, reused
 * unmodified), constrained to `LEARNING_ROOT_CAUSES`. The
 * PredictionOutcome half of this pipeline already exists and is
 * unmodified (`predictionOutcomeService.resolve`'s own automatic
 * threshold-triggered creation, §28) — this covers the genuinely new
 * half: a human REJECTING a `BusinessReviewMemo` is itself a real
 * failure signal nothing in M1-M8 turns into a lesson. Triggered only
 * as a RECORD, never automatically rewriting an agent prompt or code
 * (`suggestedProcessChange` stays free text a human reads — M9 adds
 * zero new write paths from a LearningRecord to anything executable).
 */
export const learningService = {
  async recordFromRejectedMemo(params: RecordFromRejectedMemoParams): Promise<LearningRecord> {
    if (!isLearningRootCause(params.rootCause)) {
      throw new ValidationError(`Unknown learning root cause: ${params.rootCause}`);
    }
    const memo = await businessReviewMemoRepository.findById(params.businessReviewMemoId);
    if (!memo) throw new NotFoundError("BusinessReviewMemo", params.businessReviewMemoId);
    if (memo.humanDecision !== "REJECT") {
      throw new ValidationError(`BusinessReviewMemo ${memo.id} was not REJECTed (humanDecision: ${memo.humanDecision ?? "PENDING"}) — a learning record is only recorded for a real rejection.`);
    }

    const record = await learningRecordRepository.create({
      businessReviewMemoId: memo.id,
      errorDescription: `Human REJECTed the recommendation "${memo.recommendation}" for BusinessReviewMemo ${memo.id}${memo.humanReason ? `: ${memo.humanReason}` : "."}`,
      rootCause: params.rootCause,
      lesson: params.lesson,
      suggestedProcessChange: params.suggestedProcessChange ?? undefined,
    });

    await eventBus.publish({ type: "LESSON_CREATED", payload: { learningRecordId: record.id, businessReviewMemoId: memo.id, rootCause: params.rootCause } });

    return record;
  },

  list: learningRecordRepository.list,
};

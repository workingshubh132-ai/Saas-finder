import type { LearningRecord, PredictionOutcome } from "@prisma/client";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { predictionOutcomeRepository } from "../db/repositories/prediction-outcome.repository.js";
import { assertPredictionIsForward, assertResolutionNotPremature, computePredictionErrorPct } from "../domain/prediction/prediction-outcome.types.js";
import { shouldGenerateLearningRecord } from "../domain/learning/learning-record.types.js";

export interface RecordPredictionParams {
  productId: string;
  metricType: string;
  predictedValue: number;
  targetPeriodStart: Date;
  targetPeriodEnd: Date;
  predictionSource: string;
  now?: Date;
}

export interface ResolvePredictionParams {
  predictionOutcomeId: string;
  observedValue: number;
  now?: Date;
}

/**
 * Prediction tracking (Constitution §23; docs/M8_ARCHITECTURE_PROPOSAL.md
 * §38) — recorded before outcomes are known, resolved only once the
 * target period has actually elapsed (no future-information leakage).
 * A resolution whose error exceeds the threshold generates a
 * LearningRecord automatically — Constitution §22's own pipeline,
 * never an agent free-associating a lesson.
 */
export const predictionOutcomeService = {
  async record(params: RecordPredictionParams): Promise<PredictionOutcome> {
    const predictedAt = params.now ?? new Date();
    assertPredictionIsForward(predictedAt, params.targetPeriodEnd);
    return predictionOutcomeRepository.create({
      productId: params.productId,
      metricType: params.metricType,
      predictedValue: params.predictedValue,
      predictedAt,
      targetPeriodStart: params.targetPeriodStart,
      targetPeriodEnd: params.targetPeriodEnd,
      predictionSource: params.predictionSource,
    });
  },

  async resolve(params: ResolvePredictionParams): Promise<{ outcome: PredictionOutcome; learningRecord: LearningRecord | null }> {
    const outcome = await predictionOutcomeRepository.getOrThrow(params.predictionOutcomeId);
    const now = params.now ?? new Date();
    assertResolutionNotPremature(outcome.targetPeriodEnd, now);

    const errorPct = computePredictionErrorPct(outcome.predictedValue, params.observedValue);
    const resolved = await predictionOutcomeRepository.resolve(outcome.id, params.observedValue, errorPct, now);

    let learningRecord: LearningRecord | null = null;
    if (shouldGenerateLearningRecord(errorPct)) {
      learningRecord = await learningRecordRepository.create({
        predictionOutcomeId: resolved.id,
        errorDescription: `Predicted ${outcome.metricType}=${outcome.predictedValue} (source: ${outcome.predictionSource}) for the period ending ${outcome.targetPeriodEnd.toISOString()}; observed ${params.observedValue} (${errorPct !== null ? `${(errorPct * 100).toFixed(1)}% error` : "error undefined"}).`,
      });
    }

    return { outcome: resolved, learningRecord };
  },

  listForProduct: predictionOutcomeRepository.listForProduct,
};

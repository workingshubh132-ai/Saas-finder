import type { LearningRecord, PredictionOutcome } from "@prisma/client";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { predictionOutcomeRepository } from "../db/repositories/prediction-outcome.repository.js";
import { assertPredictionIsForward, assertResolutionNotPremature, computePredictionErrorPct } from "../domain/prediction/prediction-outcome.types.js";
import { shouldGenerateLearningRecord } from "../domain/learning/learning-record.types.js";
import { eventBus } from "./event-bus.js";

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
      // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — no event fired here before this fix.
      await eventBus.publish({ type: "LESSON_CREATED", payload: { learningRecordId: learningRecord.id, predictionOutcomeId: resolved.id, errorPct } });
    }
    await eventBus.publish({ type: "OUTCOME_OBSERVED", payload: { predictionOutcomeId: resolved.id, productId: outcome.productId, metricType: outcome.metricType, errorPct } });

    return { outcome: resolved, learningRecord };
  },

  /**
   * The single new thing M9 adds to this service
   * (docs/M9_ARCHITECTURE_PROPOSAL.md §28) — `SELECT * FROM
   * prediction_outcomes WHERE observedValue IS NULL AND
   * targetPeriodEnd <= now()` (already-existing
   * `listUnresolvedPastTarget`, unmodified), then `resolve()`
   * (unmodified) for each one whose real observed value now exists.
   * "Real observed value" means a BusinessMetric of the same type
   * actually recorded at or after the target period ended — never a
   * fabricated number; an outcome with no such metric yet is left
   * unresolved for a future OBSERVING pass. Called from the operating
   * cycle's OBSERVING stage — no background job, no new resolution
   * logic, only the missing trigger.
   */
  async resolveAllDue(now: Date = new Date()): Promise<{ resolved: PredictionOutcome[]; skipped: number }> {
    const due = await predictionOutcomeRepository.listUnresolvedPastTarget(now);
    const resolved: PredictionOutcome[] = [];
    let skipped = 0;

    for (const outcome of due) {
      const candidates = await businessMetricRepository.listForProductByType(outcome.productId, outcome.metricType);
      const observedAfterTarget = candidates.filter((m) => m.recordedAt.getTime() >= outcome.targetPeriodEnd.getTime()).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
      const observed = observedAfterTarget[0];
      if (!observed) {
        skipped += 1;
        continue;
      }
      const { outcome: resolvedOutcome } = await predictionOutcomeService.resolve({ predictionOutcomeId: outcome.id, observedValue: observed.value, now });
      resolved.push(resolvedOutcome);
    }

    return { resolved, skipped };
  },

  listForProduct: predictionOutcomeRepository.listForProduct,
};

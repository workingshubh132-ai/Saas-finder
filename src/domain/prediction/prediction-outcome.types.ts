import { ValidationError } from "../shared/errors.js";

/**
 * Prediction tracking (Constitution §23; docs/M8_ARCHITECTURE_PROPOSAL.md
 * §38) — "important predictions should be recorded before outcomes
 * become known... after the outcome occurs, predictions are compared
 * with reality." A prediction targeting a metric type already covered
 * by BusinessMetricType (docs/business-metric/business-metric.types.ts)
 * — no separate prediction-metric vocabulary.
 */
export function assertPredictionIsForward(predictedAt: Date, targetPeriodEnd: Date): void {
  if (targetPeriodEnd.getTime() <= predictedAt.getTime()) {
    throw new ValidationError(
      `A prediction's targetPeriodEnd (${targetPeriodEnd.toISOString()}) must be after predictedAt (${predictedAt.toISOString()}) — predictions must be recorded before outcomes become known (Constitution §23).`,
    );
  }
}

/**
 * The concrete backtesting-integrity rule: no future-information
 * leakage. A prediction may only be resolved once its target period
 * has actually elapsed, never earlier (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §38).
 */
export function assertResolutionNotPremature(targetPeriodEnd: Date, now: Date): void {
  if (now.getTime() < targetPeriodEnd.getTime()) {
    throw new ValidationError(
      `Cannot resolve a prediction before its target period has elapsed (targetPeriodEnd=${targetPeriodEnd.toISOString()}, now=${now.toISOString()}) — no future-information leakage.`,
    );
  }
}

/** Relative error — undefined (returns null) when predictedValue is exactly zero, never a fabricated Infinity. */
export function computePredictionErrorPct(predictedValue: number, observedValue: number): number | null {
  if (predictedValue === 0) {
    return observedValue === 0 ? 0 : null;
  }
  return (observedValue - predictedValue) / Math.abs(predictedValue);
}

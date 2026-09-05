import { predictionOutcomeRepository } from "../db/repositories/prediction-outcome.repository.js";
import type { CalibrationSummary } from "../domain/decision/calibration.js";
import { calibrationService } from "./calibration.service.js";

export interface PredictionAccuracyBySource {
  readonly source: string;
  readonly count: number;
  /** Null when zero resolved predictions exist for this source yet — never a fabricated 0%. */
  readonly avgAbsErrorPct: number | null;
}

export interface DecisionQualityDashboard {
  readonly investment: CalibrationSummary;
  readonly customerDiscovery: CalibrationSummary;
  readonly productBuilds: CalibrationSummary;
  readonly launch: CalibrationSummary;
  readonly businessDecisions: CalibrationSummary;
  /** The sixth, genuinely new axis (docs/M9_ARCHITECTURE_PROPOSAL.md §29) — none of the five existing summarize* methods cover prediction accuracy. */
  readonly predictionAccuracyBySource: readonly PredictionAccuracyBySource[];
}

/**
 * `decisionQualityService.getDashboard()` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §29) — composes the five EXISTING `calibrationService.summarize*`
 * methods (unmodified) into one company-wide view, plus prediction
 * accuracy (`AVG(ABS(errorPct))` grouped by `PredictionOutcome.predictionSource`)
 * from already-resolved rows (§28). "Do not optimize solely for being
 * right — track calibration and uncertainty" is satisfied because
 * `summarizeCalibration` (reused, unmodified) already buckets by
 * confidence and reports the APPROVE rate PER BUCKET, not one
 * aggregate accuracy number.
 */
export const decisionQualityService = {
  async getDashboard(): Promise<DecisionQualityDashboard> {
    const [investment, customerDiscovery, productBuilds, launch, businessDecisions, resolvedOutcomes] = await Promise.all([
      calibrationService.summarize(),
      calibrationService.summarizeCustomerDiscovery(),
      calibrationService.summarizeProductBuilds(),
      calibrationService.summarizeLaunch(),
      calibrationService.summarizeBusinessDecisions(),
      predictionOutcomeRepository.listResolved(),
    ]);

    const errorsBySource = new Map<string, number[]>();
    for (const outcome of resolvedOutcomes) {
      if (outcome.errorPct === null) continue;
      const errors = errorsBySource.get(outcome.predictionSource) ?? [];
      errors.push(Math.abs(outcome.errorPct));
      errorsBySource.set(outcome.predictionSource, errors);
    }

    const predictionAccuracyBySource: PredictionAccuracyBySource[] = Array.from(errorsBySource.entries()).map(([source, errors]) => ({
      source,
      count: errors.length,
      avgAbsErrorPct: errors.length > 0 ? errors.reduce((sum, e) => sum + e, 0) / errors.length : null,
    }));

    return { investment, customerDiscovery, productBuilds, launch, businessDecisions, predictionAccuracyBySource };
  },
};

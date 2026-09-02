/**
 * Calibration tracking (M4 brief Part 39; docs/M4_ARCHITECTURE_PROPOSAL.md
 * §28) — begins tracking predicted confidence against the eventual
 * human decision, using data `DecisionRecord` already stores
 * (`confidenceAtDecision`, `humanDecision`). A pure, read-only
 * summary — no model retraining, no automatic recalibration of any
 * scoring formula; that stays out of scope through M4 (Part 38: NO
 * automatic model retraining, just structured data for future
 * calibration/prompt/scoring work).
 *
 * M5 (docs/M5_ARCHITECTURE_PROPOSAL.md §32) reuses this exact function
 * — not a new mechanism — for `CustomerDiscoveryMemo.confidence` vs.
 * `CustomerDiscoveryMemo.humanDecision`, the natural M5 analog of
 * `DecisionRecord`'s own pair. The one real difference is which string
 * counts as "positive": M4's decision enum uses `"APPROVED"`, M5's uses
 * `"APPROVE"` — so `positiveDecision` is an explicit, required
 * parameter rather than a hardcoded literal, to keep both call sites
 * honest about which label they mean instead of silently sharing one.
 */
export interface CalibrationInput {
  confidenceAtDecision: number | null;
  humanDecision: string;
}

export interface CalibrationBucket {
  range: string;
  count: number;
  approvedCount: number;
  /** Null when the bucket has zero decisions — never a fabricated 0%. */
  approvedRate: number | null;
}

export interface CalibrationSummary {
  totalDecisions: number;
  buckets: CalibrationBucket[];
  /** True until enough historical decisions exist to say anything meaningful — never claim calibration quality prematurely. */
  insufficientSampleSize: boolean;
}

const BUCKET_BOUNDARIES = [0, 0.2, 0.4, 0.6, 0.8, 1.0] as const;
/** Founder-revisable, like every other threshold in this codebase — not derived from a statistical power calculation. */
const MIN_SAMPLE_SIZE_FOR_CONFIDENCE = 20;

export function summarizeCalibration(records: readonly CalibrationInput[], positiveDecision: string): CalibrationSummary {
  const scored = records.filter((r): r is CalibrationInput & { confidenceAtDecision: number } => r.confidenceAtDecision !== null);

  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < BUCKET_BOUNDARIES.length - 1; i += 1) {
    const lo = BUCKET_BOUNDARIES[i]!;
    const hi = BUCKET_BOUNDARIES[i + 1]!;
    const isLastBucket = i === BUCKET_BOUNDARIES.length - 2;
    const inBucket = scored.filter((r) => r.confidenceAtDecision >= lo && (isLastBucket ? r.confidenceAtDecision <= hi : r.confidenceAtDecision < hi));
    const approved = inBucket.filter((r) => r.humanDecision === positiveDecision);
    buckets.push({
      range: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      count: inBucket.length,
      approvedCount: approved.length,
      approvedRate: inBucket.length > 0 ? approved.length / inBucket.length : null,
    });
  }

  return {
    totalDecisions: records.length,
    buckets,
    insufficientSampleSize: records.length < MIN_SAMPLE_SIZE_FOR_CONFIDENCE,
  };
}

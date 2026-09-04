/**
 * Revenue concentration risk (docs/M8_ARCHITECTURE_PROPOSAL.md §23) —
 * the brief's own example: "revenue increased, but the increase came
 * from one customer." Deterministic, no model call.
 */
export const REVENUE_CONCENTRATION_THRESHOLD = 0.5;

export interface ConcentrationCheckResult {
  readonly isConcentrated: boolean;
  readonly topShare: number;
}

export function checkRevenueConcentration(subscriptionValuesUsd: readonly number[]): ConcentrationCheckResult {
  const total = subscriptionValuesUsd.reduce((sum, v) => sum + v, 0);
  if (total <= 0 || subscriptionValuesUsd.length === 0) {
    return { isConcentrated: false, topShare: 0 };
  }
  const topShare = Math.max(...subscriptionValuesUsd) / total;
  return { isConcentrated: topShare >= REVENUE_CONCENTRATION_THRESHOLD, topShare };
}

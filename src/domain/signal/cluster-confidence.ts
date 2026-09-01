/**
 * Deterministic cluster confidence (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §6) — weighted toward source independence (0.6) over raw average
 * signal quality (0.4), since Part 13's "100 posts != 100 independent
 * customers" is the more important corrective: a cluster of ten
 * high-quality signals from one thread should NOT outscore three
 * decent signals from three independent sources.
 */

const INDEPENDENCE_FULL_CREDIT_COUNT = 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeClusterConfidence(memberQualityScores: readonly number[], independentSourceCount: number): number {
  if (memberQualityScores.length === 0) return 0;
  const averageQuality = memberQualityScores.reduce((sum, score) => sum + score, 0) / memberQualityScores.length;
  const independenceFactor = clamp01(independentSourceCount / INDEPENDENCE_FULL_CREDIT_COUNT);
  return clamp01(0.6 * independenceFactor + 0.4 * averageQuality);
}

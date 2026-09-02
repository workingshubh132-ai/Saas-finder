/**
 * Evidence freshness policy (docs/M4_ARCHITECTURE_PROPOSAL.md §9) — a
 * documented, founder-revisable bracket, same shape as
 * `RESEARCH_QUESTION_TEMPLATES`/`DIMENSION_WEIGHTS`. Feeds the
 * `recency` factor in the evidence-quality assessment (§8).
 */
const FRESH_MAX_AGE_DAYS = 30;
const AGING_MAX_AGE_DAYS = 180;

export const RECENCY_SCORE = {
  FRESH: 1.0,
  AGING: 0.6,
  STALE: 0.3,
} as const;

/**
 * `referenceDate` defaults to the real event date (`Signal.publishedAt`)
 * when known; callers without one should pass `Evidence.collectedAt`
 * instead — never `null`, since missing-date evidence is deliberately
 * scored as the conservative STALE bracket, not an assumed-fresh 1.0.
 */
export function computeRecencyScore(referenceDate: Date | null, now: Date = new Date()): number {
  if (referenceDate === null) return RECENCY_SCORE.STALE;

  const ageDays = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= FRESH_MAX_AGE_DAYS) return RECENCY_SCORE.FRESH;
  if (ageDays <= AGING_MAX_AGE_DAYS) return RECENCY_SCORE.AGING;
  return RECENCY_SCORE.STALE;
}

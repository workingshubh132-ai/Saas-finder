/**
 * The shared "period" concept `CompanyBudget`/`ResourceAllocation` both
 * key on (docs/M9_ARCHITECTURE_PROPOSAL.md §23, §50) — a week, matching
 * the brief's own weekend cadence. ISO-8601 week format (`YYYY-Www`),
 * Monday-start, so two independent call sites can never silently drift
 * onto different period boundaries.
 */
export function currentPeriod(now: Date = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNumber = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

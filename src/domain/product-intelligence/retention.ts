/**
 * Retention analysis (docs/M8_ARCHITECTURE_PROPOSAL.md §5). Deterministic,
 * no model call. Returns its own richer discriminated union rather than
 * the generic MetricResult, since a computed result carries cohortSize/
 * retainedCount alongside the rate (M8 brief §5's own stated shape).
 */
export const RETENTION_WINDOWS = ["D1", "D7", "D14", "D30"] as const;
export type RetentionWindow = (typeof RETENTION_WINDOWS)[number];

export function isRetentionWindow(value: string): value is RetentionWindow {
  return (RETENTION_WINDOWS as readonly string[]).includes(value);
}

const WINDOW_DAYS: Readonly<Record<RetentionWindow, number>> = { D1: 1, D7: 7, D14: 14, D30: 30 };

/** Below this many cohort members who have actually reached the window, retention is not reported (M8 brief §5). */
export const MIN_RETENTION_COHORT = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export interface RetentionCohortMember {
  readonly signedUpAt: Date;
  /** Most recent observed activity, or null if never active again after signup. */
  readonly lastActiveAt: Date | null;
}

export type RetentionResult =
  | {
      readonly window: RetentionWindow;
      readonly status: "COMPUTED";
      readonly cohortSize: number;
      readonly retainedCount: number;
      readonly retentionRate: number;
    }
  | { readonly window: RetentionWindow; readonly status: "INSUFFICIENT_DATA"; readonly reason: string };

/**
 * A cohort member is only *eligible* to be measured for a window once
 * that many days have actually elapsed since their signup — a D30
 * number for a cohort that signed up 12 days ago is not a low number,
 * it is not a number (docs/M8_ARCHITECTURE_PROPOSAL.md §5's own fix for
 * the naive-implementation bug this exists to prevent).
 */
export function computeRetention(window: RetentionWindow, members: readonly RetentionCohortMember[], now: Date): RetentionResult {
  const windowDays = WINDOW_DAYS[window];
  const eligible = members.filter((m) => daysBetween(m.signedUpAt, now) >= windowDays);

  if (eligible.length < MIN_RETENTION_COHORT) {
    return {
      window,
      status: "INSUFFICIENT_DATA",
      reason: `Only ${eligible.length} cohort member(s) have reached the ${window} mark (need >= ${MIN_RETENTION_COHORT}).`,
    };
  }

  const retained = eligible.filter((m) => m.lastActiveAt !== null && daysBetween(m.signedUpAt, m.lastActiveAt) >= windowDays);

  return {
    window,
    status: "COMPUTED",
    cohortSize: eligible.length,
    retainedCount: retained.length,
    retentionRate: retained.length / eligible.length,
  };
}

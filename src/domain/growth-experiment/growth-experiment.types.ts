import type { TransitionTable } from "../shared/state-machine.js";

/**
 * GrowthExperiment lifecycle (docs/M8_ARCHITECTURE_PROPOSAL.md §26) —
 * named distinctly from M5's OutreachExperiment (which tests *outbound
 * messaging* to prospects; this tests *product/pricing/onboarding*
 * changes against already-live traffic — a different kind of thing,
 * and reusing the name would collide two unrelated concepts).
 * "Do not allow an experiment to run without the appropriate
 * approval" (M8 brief §15) is enforced structurally: nothing in this
 * codebase can move APPROVED -> RUNNING except a human-actor-gated
 * service call (growthExperimentService.approveToRun).
 */
export const GROWTH_EXPERIMENT_STATUSES = [
  "DRAFT",
  "ANALYZED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "RUNNING",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "FAILED",
] as const;
export type GrowthExperimentStatus = (typeof GROWTH_EXPERIMENT_STATUSES)[number];

export function isGrowthExperimentStatus(value: string): value is GrowthExperimentStatus {
  return (GROWTH_EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

export const GROWTH_EXPERIMENT_TRANSITIONS: TransitionTable<GrowthExperimentStatus> = {
  DRAFT: ["ANALYZED", "CANCELLED"],
  ANALYZED: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
  // A completed experiment's results feed a fresh analysis pass — the
  // brief's own diagram shows COMPLETED -> ANALYZED as a real edge,
  // distinct from the first DRAFT -> ANALYZED (this is "analyzed
  // again, now with real results" rather than "analyzed before running").
  COMPLETED: ["ANALYZED"],
  REJECTED: [],
  CANCELLED: [],
  FAILED: [],
};

export const GROWTH_EXPERIMENT_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type GrowthExperimentRiskLevel = (typeof GROWTH_EXPERIMENT_RISK_LEVELS)[number];

export function isGrowthExperimentRiskLevel(value: string): value is GrowthExperimentRiskLevel {
  return (GROWTH_EXPERIMENT_RISK_LEVELS as readonly string[]).includes(value);
}

/**
 * A result's confidence is honest about sample size, never a
 * fabricated p-value (M8 brief §16, §51 "no fabricated statistical
 * significance") — this codebase has no statistics dependency and
 * will not hand-roll significance testing (docs/M8_ARCHITECTURE_PROPOSAL.md §40).
 */
export const GROWTH_EXPERIMENT_RESULT_CONFIDENCE = ["LOW_CONFIDENCE", "MODERATE", "HIGH_CONFIDENCE"] as const;
export type GrowthExperimentResultConfidence = (typeof GROWTH_EXPERIMENT_RESULT_CONFIDENCE)[number];

export function isGrowthExperimentResultConfidence(value: string): value is GrowthExperimentResultConfidence {
  return (GROWTH_EXPERIMENT_RESULT_CONFIDENCE as readonly string[]).includes(value);
}

export const MIN_EXPERIMENT_SAMPLE = 30;

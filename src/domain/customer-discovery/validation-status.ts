import { wtpLevelAtLeast, type WtpLevel } from "./wtp.js";

/**
 * Customer-discovery evidence-sufficiency ladder (Phase 5). Deliberately
 * separate from Opportunity.validationLevel (LEVEL_0..LEVEL_8,
 * src/domain/opportunity/validation-level.ts) — that ladder tracks the
 * opportunity's overall lifecycle stage across every evidence type
 * (market, competitor, customer, economics); this one answers a single
 * narrower question, "is customer-discovery evidence, specifically,
 * sufficient to build?" A human decision (customerDiscoveryMemoService
 * / this evaluator) may still choose to advance the broader ladder, but
 * that remains a separate, explicit, human-invoked call — this module
 * never calls opportunityService.setValidationLevel() itself.
 */
export const CUSTOMER_VALIDATION_STATUSES = ["UNVALIDATED", "INTERESTING", "STRONG", "BUILD_CANDIDATE", "REJECTED"] as const;
export type CustomerValidationStatus = (typeof CUSTOMER_VALIDATION_STATUSES)[number];

export function isCustomerValidationStatus(value: string): value is CustomerValidationStatus {
  return (CUSTOMER_VALIDATION_STATUSES as readonly string[]).includes(value);
}

/** Explicit constants, never magic numbers scattered through the evaluator. */
export const CUSTOMER_VALIDATION_THRESHOLDS = {
  MIN_BUSINESSES_FOR_STRONG: 2,
  MIN_BUSINESSES_FOR_BUILD_CANDIDATE: 2,
  MIN_WTP_LEVEL_FOR_BUILD_CANDIDATE: "STRONG" as WtpLevel,
} as const;

export interface CustomerValidationInput {
  /** Distinct organizations whose interactionOutcome === "PROBLEM_CONFIRMED" (or legacy-path equivalent). */
  readonly confirmingBusinessCount: number;
  /** True once at least one OBSERVED FREQUENCY, VOLUME, or TIME_COST finding exists among confirming businesses. */
  readonly recurringOrMeasurablePainConfirmed: boolean;
  /** The single highest WTP level reached by any confirming business (classifyWtp, taken across all of that business's OBSERVED findings). */
  readonly bestWtpLevel: WtpLevel;
  /** Non-empty means REJECTED, checked before anything else. Each entry is a human-readable reason, e.g. "2 independent businesses said they do not experience this." */
  readonly disqualifyingReasons: readonly string[];
}

export interface CustomerValidationResult {
  readonly status: CustomerValidationStatus;
  readonly reasons: string[];
  readonly evidenceGaps: string[];
}

/**
 * Pure, deterministic, no model call (Phase 5's explicit requirement).
 * Every branch states exactly which threshold was or wasn't met, so a
 * reviewer never has to reverse-engineer why a status was reached.
 */
export function evaluateCustomerValidation(input: CustomerValidationInput): CustomerValidationResult {
  if (input.disqualifyingReasons.length > 0) {
    return { status: "REJECTED", reasons: [...input.disqualifyingReasons], evidenceGaps: [] };
  }

  if (input.confirmingBusinessCount === 0) {
    return {
      status: "UNVALIDATED",
      reasons: ["No independent business has confirmed the problem yet — insufficient customer evidence to say more."],
      evidenceGaps: ["At least one real, independent customer conversation confirming the problem."],
    };
  }

  const gaps: string[] = [];
  if (input.confirmingBusinessCount < CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_STRONG) {
    gaps.push(
      `Only ${input.confirmingBusinessCount} independent business(es) confirming — at least ${CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_STRONG} needed for STRONG.`,
    );
    if (!input.recurringOrMeasurablePainConfirmed) gaps.push("Recurring or measurable pain (frequency, volume, or time-cost) not yet established.");
    if (!wtpLevelAtLeast(input.bestWtpLevel, "MEDIUM")) gaps.push(`Willingness-to-pay evidence is still ${input.bestWtpLevel}.`);
    return {
      status: "INTERESTING",
      reasons: [`${input.confirmingBusinessCount} independent business confirms the problem is plausible.`],
      evidenceGaps: gaps,
    };
  }

  if (!input.recurringOrMeasurablePainConfirmed) {
    gaps.push("Recurring or measurable pain (frequency, volume, or time-cost) not yet established across confirming businesses.");
    return {
      status: "INTERESTING",
      reasons: [`${input.confirmingBusinessCount} independent businesses confirm the problem, but recurring/measurable pain is not yet established.`],
      evidenceGaps: gaps,
    };
  }

  const meetsBuildCandidate =
    input.confirmingBusinessCount >= CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_BUILD_CANDIDATE &&
    wtpLevelAtLeast(input.bestWtpLevel, CUSTOMER_VALIDATION_THRESHOLDS.MIN_WTP_LEVEL_FOR_BUILD_CANDIDATE);

  if (meetsBuildCandidate) {
    return {
      status: "BUILD_CANDIDATE",
      reasons: [
        `${input.confirmingBusinessCount} independent businesses confirm recurring/measurable pain, and willingness-to-pay evidence reaches ${input.bestWtpLevel}.`,
      ],
      evidenceGaps: [],
    };
  }

  gaps.push(
    `Willingness-to-pay evidence is currently ${input.bestWtpLevel} — needs to reach ${CUSTOMER_VALIDATION_THRESHOLDS.MIN_WTP_LEVEL_FOR_BUILD_CANDIDATE} or higher for BUILD_CANDIDATE.`,
  );
  return {
    status: "STRONG",
    reasons: [`${input.confirmingBusinessCount} independent businesses confirm recurring/measurable pain.`],
    evidenceGaps: gaps,
  };
}

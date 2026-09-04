import { type MetricResult, computed, insufficientData } from "../shared/metric-result.js";
import { ValidationError } from "../shared/errors.js";

/**
 * Below this signup count, an activation rate is not trustworthy
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §4 — "do not manufacture values
 * from insufficient observations").
 */
export const MIN_ACTIVATION_SAMPLE = 5;

export interface ActivationRateInput {
  readonly signupCount: number;
  readonly activatedCount: number;
}

/**
 * Deterministic, no model call. Activation itself is product-defined
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §4) — this function only turns an
 * already-computed signup/activated pair into a rate; which event
 * counts as "activated" lives in `ActivationDefinition`, set once per
 * product, never assumed here.
 */
export function computeActivationRate(input: ActivationRateInput): MetricResult {
  if (input.signupCount < 0 || input.activatedCount < 0) {
    throw new ValidationError(`Activation counts must be non-negative (signupCount=${input.signupCount}, activatedCount=${input.activatedCount}).`);
  }
  if (input.activatedCount > input.signupCount) {
    throw new ValidationError(`activatedCount (${input.activatedCount}) cannot exceed signupCount (${input.signupCount}) — impossible value.`);
  }
  if (input.signupCount < MIN_ACTIVATION_SAMPLE) {
    return insufficientData(
      `Only ${input.signupCount} signup(s) observed — need at least ${MIN_ACTIVATION_SAMPLE} before an activation rate is trustworthy.`,
    );
  }
  return computed(input.activatedCount / input.signupCount);
}

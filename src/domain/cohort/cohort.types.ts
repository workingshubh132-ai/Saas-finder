/**
 * A cohort dimension (docs/M8_ARCHITECTURE_PROPOSAL.md §6) — the
 * closed set of ways this codebase is willing to split a product's
 * users into comparable groups. `buildCohorts` only ever proposes a
 * dimension the available data actually supports (e.g. never an
 * ACQUISITION_EXPERIMENT split for a product with zero GrowthExperiment
 * rows) — the set below is the vocabulary, not a promise every value
 * is always usable.
 */
export const COHORT_DIMENSIONS = [
  "SIGNUP_DATE",
  "ACQUISITION_EXPERIMENT",
  "ACQUISITION_CHANNEL",
  "PRICING_PLAN",
  "PRODUCT_VERSION",
] as const;
export type CohortDimension = (typeof COHORT_DIMENSIONS)[number];

export function isCohortDimension(value: string): value is CohortDimension {
  return (COHORT_DIMENSIONS as readonly string[]).includes(value);
}

/** A cohort is a label, not a metric — its actual numbers are BusinessMetric rows with a `cohortId` FK. */
export interface CohortDefinition {
  readonly productId: string;
  readonly dimension: CohortDimension;
  readonly dimensionValue: string;
}

const MIN_COHORT_SAMPLE_FOR_DIMENSION = 2;

/**
 * Deterministic — cohort membership is a pure function of already-recorded
 * signup timestamps/tags, never a model call. Only proposes a dimension
 * split when at least two distinct values exist for it (a "cohort" of
 * one value is not a comparison).
 */
export function buildCohorts(
  productId: string,
  dimension: CohortDimension,
  observedValues: readonly string[],
): CohortDefinition[] {
  const distinct = [...new Set(observedValues.filter((v) => v.trim().length > 0))];
  if (distinct.length < MIN_COHORT_SAMPLE_FOR_DIMENSION) {
    return [];
  }
  return distinct.map((dimensionValue) => ({ productId, dimension, dimensionValue }));
}

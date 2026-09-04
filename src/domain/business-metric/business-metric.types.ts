/**
 * The structural "observed vs. estimated" enforcement Section 45 of
 * the M7 brief demanded (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §23),
 * widened for M8's own Section 1 non-negotiable
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §9, §11): valueKind is a real
 * column, never a prose label, and every read path must group or
 * label by it — an aggregate that silently blends OBSERVED and
 * ESTIMATED (or INFERRED, or PREDICTED) numbers is exactly the "fake
 * business" failure mode this exists to prevent.
 */
export const BUSINESS_METRIC_TYPES = [
  // M7
  "REVENUE_USD",
  "ACTIVE_SUBSCRIPTIONS",
  "UPTIME_PCT",
  "CONVERSION_RATE",
  "MONTHLY_OPERATING_COST_USD",
  "CHURN_RATE",
  // M8 — product intelligence (docs/M8_ARCHITECTURE_PROPOSAL.md §4-5)
  "ACTIVATION_RATE",
  "RETENTION_D1",
  "RETENTION_D7",
  "RETENTION_D14",
  "RETENTION_D30",
  // M8 — revenue intelligence (§7, §16)
  "MRR",
  "ARR",
  "ARPU",
  "GROSS_MARGIN_PCT",
  // M8 — churn, kept separate per §7 ("do not confuse them")
  "LOGO_CHURN_RATE",
  "REVENUE_CHURN_RATE",
  "GROSS_REVENUE_RETENTION",
  "NET_REVENUE_RETENTION",
  // M8 — unit economics (§18)
  "CAC",
  "LTV",
  "LTV_TO_CAC",
  "PAYBACK_PERIOD_MONTHS",
] as const;
export type BusinessMetricType = (typeof BUSINESS_METRIC_TYPES)[number];

export function isBusinessMetricType(value: string): value is BusinessMetricType {
  return (BUSINESS_METRIC_TYPES as readonly string[]).includes(value);
}

/**
 * Widened from OBSERVED|ESTIMATED (M7) to four values
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §9, §11 — M8 brief Section 1's own
 * non-negotiable). OBSERVED: read directly from a provider, no
 * computation beyond unit conversion. ESTIMATED: a human or agent
 * supplied a number without full provider backing (M7's original
 * meaning, unchanged). INFERRED: deterministically computed from other
 * OBSERVED/INFERRED metrics. PREDICTED: a forward-looking number
 * attached to a not-yet-elapsed period — never displayed as a current
 * fact, only ever compared against reality later (see
 * domain/prediction/prediction-outcome.types.ts).
 */
export const BUSINESS_METRIC_VALUE_KINDS = ["OBSERVED", "ESTIMATED", "INFERRED", "PREDICTED"] as const;
export type BusinessMetricValueKind = (typeof BUSINESS_METRIC_VALUE_KINDS)[number];

export function isBusinessMetricValueKind(value: string): value is BusinessMetricValueKind {
  return (BUSINESS_METRIC_VALUE_KINDS as readonly string[]).includes(value);
}

/** Where a metric's value actually came from — never optional, never inferred after the fact. */
export const BUSINESS_METRIC_SOURCES = [
  "DEV_FIXTURE",
  "MANUAL_ENTRY",
  "COMPUTED_ESTIMATE",
  // M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §9, §31)
  "REVENUE_PROVIDER",
  "PRODUCT_USAGE_PROVIDER",
  "CUSTOMER_DATA_PROVIDER",
  "DETERMINISTIC_CALCULATION",
] as const;
export type BusinessMetricSource = (typeof BUSINESS_METRIC_SOURCES)[number];

export function isBusinessMetricSource(value: string): value is BusinessMetricSource {
  return (BUSINESS_METRIC_SOURCES as readonly string[]).includes(value);
}

/** Sources that represent a direct provider read — the only sources `OBSERVED` may ever pair with. */
const PROVIDER_SOURCES: ReadonlySet<BusinessMetricSource> = new Set([
  "DEV_FIXTURE",
  "REVENUE_PROVIDER",
  "PRODUCT_USAGE_PROVIDER",
  "CUSTOMER_DATA_PROVIDER",
]);

/**
 * The one function that ever constructs a BusinessMetric input passes
 * through here first (docs/M8_ARCHITECTURE_PROPOSAL.md §9) — the
 * concrete rule that makes "MRR = $50,000" always answerable as
 * observed/estimated/inferred/predicted, and from where. Throws rather
 * than silently accepting a nonsensical pairing (e.g. `OBSERVED` from
 * `MANUAL_ENTRY`, or `INFERRED` from a provider with no inputs cited).
 */
export function assertMetricProvenance(input: {
  readonly valueKind: BusinessMetricValueKind;
  readonly source: BusinessMetricSource;
  readonly inputMetricIds?: readonly string[];
}): void {
  if (input.valueKind === "OBSERVED" && !PROVIDER_SOURCES.has(input.source)) {
    throw new Error(
      `[business-metric] valueKind "OBSERVED" requires a provider source (got "${input.source}") — an observed value must come directly from a provider, never a manual entry or a calculation.`,
    );
  }
  if (input.valueKind === "INFERRED" && input.source !== "DETERMINISTIC_CALCULATION") {
    throw new Error(
      `[business-metric] valueKind "INFERRED" requires source "DETERMINISTIC_CALCULATION" (got "${input.source}").`,
    );
  }
  if (input.valueKind === "INFERRED" && (!input.inputMetricIds || input.inputMetricIds.length === 0)) {
    throw new Error(`[business-metric] valueKind "INFERRED" requires at least one inputMetricIds entry — an inferred value must cite what it was inferred from.`);
  }
}

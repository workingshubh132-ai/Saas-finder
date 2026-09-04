import { type MetricResult, computed, insufficientData, UNKNOWN } from "../shared/metric-result.js";

/**
 * Post-launch unit economics (docs/M8_ARCHITECTURE_PROPOSAL.md §18) —
 * deliberately a SEPARATE function from
 * `src/domain/pricing-model/unit-economics.ts`'s `computeUnitEconomics`
 * (M7), which projects margin from a *proposed* price before any
 * customer exists. This one measures margin from *observed* revenue
 * and cost after launch. Reusing one function for both would silently
 * blend a pre-launch estimate with a post-launch observation — exactly
 * what M8 brief Section 1 forbids. NEVER fabricate CAC or LTV: CAC is
 * the literal string "UNKNOWN" when acquisition spend isn't tracked;
 * LTV is "INSUFFICIENT_DATA" when retention history is too short —
 * both real members of MetricResult's discriminated union, never a
 * sentinel number a caller could mistake for a real one.
 */
export const MIN_LTV_HISTORY_MONTHS = 3;

export interface UnitEconomicsInput {
  readonly arpuUsd: MetricResult;
  readonly grossMarginPct: MetricResult;
  /** null = acquisition spend is not tracked at all for this product -> CAC is UNKNOWN, not merely insufficient. */
  readonly totalAcquisitionSpendUsd: number | null;
  readonly newCustomersInPeriod: number;
  readonly retentionHistoryMonths: number;
  readonly avgCustomerLifespanMonths: MetricResult;
}

export interface UnitEconomicsResult {
  readonly cac: MetricResult;
  readonly ltv: MetricResult;
  readonly ltvToCac: MetricResult;
  readonly paybackPeriodMonths: MetricResult;
}

export function computeUnitEconomics(input: UnitEconomicsInput): UnitEconomicsResult {
  const cac: MetricResult =
    input.totalAcquisitionSpendUsd === null
      ? UNKNOWN
      : input.newCustomersInPeriod <= 0
        ? insufficientData("No new customers in period — CAC is undefined.")
        : computed(input.totalAcquisitionSpendUsd / input.newCustomersInPeriod);

  const ltv: MetricResult =
    input.retentionHistoryMonths < MIN_LTV_HISTORY_MONTHS
      ? insufficientData(
          `Only ${input.retentionHistoryMonths} month(s) of retention history — need >= ${MIN_LTV_HISTORY_MONTHS} before LTV is trustworthy.`,
        )
      : input.arpuUsd.status === "COMPUTED" && input.grossMarginPct.status === "COMPUTED" && input.avgCustomerLifespanMonths.status === "COMPUTED"
        ? computed(input.arpuUsd.value * input.grossMarginPct.value * input.avgCustomerLifespanMonths.value)
        : insufficientData("ARPU, gross margin, or average customer lifespan is not yet computable.");

  const ltvToCac: MetricResult =
    cac.status === "COMPUTED" && ltv.status === "COMPUTED"
      ? computed(ltv.value / cac.value)
      : cac.status === "UNKNOWN"
        ? UNKNOWN
        : insufficientData("LTV or CAC is not yet computable.");

  const marginPerCustomer = input.arpuUsd.status === "COMPUTED" && input.grossMarginPct.status === "COMPUTED" ? input.arpuUsd.value * input.grossMarginPct.value : null;

  const paybackPeriodMonths: MetricResult =
    cac.status === "COMPUTED" && marginPerCustomer !== null && marginPerCustomer > 0
      ? computed(cac.value / marginPerCustomer)
      : cac.status === "UNKNOWN"
        ? UNKNOWN
        : insufficientData("CAC, ARPU, or gross margin is not yet computable.");

  return { cac, ltv, ltvToCac, paybackPeriodMonths };
}

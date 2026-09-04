/**
 * Deterministic, founder-revisable unit economics
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §21) — same discipline as
 * computeCostEstimate: a rough, order-of-magnitude signal derived from
 * the product's own real operating-cost estimate and a proposed price,
 * never a model's own arithmetic, never a substitute for a real
 * usage-based cost model before any real spend.
 */
export interface UnitEconomicsInputs {
  monthlyPriceUsd: number;
  estimatedOperatingCostUsdPerMonth: number;
  estimatedCustomerCountForCostBasis: number;
}

export interface UnitEconomics {
  costPerCustomerUsd: number;
  grossMarginUsd: number;
  grossMarginPct: number;
  reasoning: string;
}

export function computeUnitEconomics(inputs: UnitEconomicsInputs): UnitEconomics {
  const customerCount = Math.max(1, inputs.estimatedCustomerCountForCostBasis);
  const costPerCustomerUsd = inputs.estimatedOperatingCostUsdPerMonth / customerCount;
  const grossMarginUsd = inputs.monthlyPriceUsd - costPerCustomerUsd;
  const grossMarginPct = inputs.monthlyPriceUsd > 0 ? grossMarginUsd / inputs.monthlyPriceUsd : 0;
  return {
    costPerCustomerUsd,
    grossMarginUsd,
    grossMarginPct,
    reasoning:
      `A rough, founder-revisable estimate: $${inputs.estimatedOperatingCostUsdPerMonth.toFixed(2)}/month operating cost spread across ` +
      `${customerCount} assumed customer(s) = $${costPerCustomerUsd.toFixed(2)}/customer; at $${inputs.monthlyPriceUsd.toFixed(2)}/month price, ` +
      `gross margin is $${grossMarginUsd.toFixed(2)} (${(grossMarginPct * 100).toFixed(1)}%). Never a substitute for a real, measured usage-based cost model.`,
  };
}

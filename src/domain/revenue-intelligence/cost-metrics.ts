/**
 * Cost breakdown (docs/M8_ARCHITECTURE_PROPOSAL.md §17) — extends M7's
 * `launch-budget.ts` from "one estimated ceiling" to a real breakdown.
 * Every line item is tagged FIXED|VARIABLE and OBSERVED|ESTIMATED
 * independently (a real 2x2, never conflated). Deterministic sum, no
 * model call.
 */
export const COST_CATEGORIES = [
  "INFRASTRUCTURE",
  "AI_MODEL_USAGE",
  "THIRD_PARTY_API",
  "EMAIL",
  "STORAGE",
  "DATABASE",
  "MONITORING",
  "SUPPORT",
  "OTHER",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export function isCostCategory(value: string): value is CostCategory {
  return (COST_CATEGORIES as readonly string[]).includes(value);
}

export const COST_NATURES = ["FIXED", "VARIABLE"] as const;
export type CostNature = (typeof COST_NATURES)[number];

export function isCostNature(value: string): value is CostNature {
  return (COST_NATURES as readonly string[]).includes(value);
}

/**
 * AI/model usage cost is the one line item this milestone treats as
 * genuinely OBSERVED rather than dev-fixture — it is computed from
 * this codebase's own real AgentExecution/ToolExecution rows already
 * recorded by M2's agent runtime for audit purposes
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §17). Every other category stays
 * ESTIMATED unless a real provider integration exists.
 */
export interface CostLineItem {
  readonly category: CostCategory;
  readonly nature: CostNature;
  readonly amountUsd: number;
  readonly observed: boolean;
}

export interface CostBreakdownResult {
  readonly lineItems: readonly CostLineItem[];
  readonly totalUsd: number;
  readonly fixedUsd: number;
  readonly variableUsd: number;
  readonly observedUsd: number;
  readonly estimatedUsd: number;
}

export function computeCostBreakdown(lineItems: readonly CostLineItem[]): CostBreakdownResult {
  const totalUsd = lineItems.reduce((sum, item) => sum + item.amountUsd, 0);
  const fixedUsd = lineItems.filter((i) => i.nature === "FIXED").reduce((sum, i) => sum + i.amountUsd, 0);
  const observedUsd = lineItems.filter((i) => i.observed).reduce((sum, i) => sum + i.amountUsd, 0);

  return {
    lineItems,
    totalUsd,
    fixedUsd,
    variableUsd: totalUsd - fixedUsd,
    observedUsd,
    estimatedUsd: totalUsd - observedUsd,
  };
}

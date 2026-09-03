/**
 * Rough, founder-revisable cost estimation (docs/M6_ARCHITECTURE_PROPOSAL.md
 * §26) — the same "a founder-revisable number like every other budget
 * in this codebase" discipline as DEFAULT_DECISION_CYCLE_BUDGET
 * (decision-cycle.service.ts). Never a substitute for a real hosting
 * or usage quote — an honest order-of-magnitude signal for the human
 * reviewing the compiled memo, derived from this build's own real
 * task/dependency counts, never a made-up number.
 */
const COST_PER_ENGINEERING_TASK_USD = 15;
const BASE_OPERATING_COST_USD = 5;
const COST_PER_EXTERNAL_DEPENDENCY_USD = 2;

export interface CostEstimateInputs {
  engineeringTaskCount: number;
  externalDependencyCount: number;
}

export interface CostEstimate {
  estimatedDevelopmentCostUsd: number;
  estimatedOperatingCostUsd: number;
  reasoning: string;
}

export function computeCostEstimate(inputs: CostEstimateInputs): CostEstimate {
  const estimatedDevelopmentCostUsd = inputs.engineeringTaskCount * COST_PER_ENGINEERING_TASK_USD;
  const estimatedOperatingCostUsd = BASE_OPERATING_COST_USD + inputs.externalDependencyCount * COST_PER_EXTERNAL_DEPENDENCY_USD;
  return {
    estimatedDevelopmentCostUsd,
    estimatedOperatingCostUsd,
    reasoning:
      `A rough, founder-revisable estimate: ${inputs.engineeringTaskCount} engineering task(s) at ~$${COST_PER_ENGINEERING_TASK_USD} each for development; ` +
      `a small server plus ${inputs.externalDependencyCount} external dependenc${inputs.externalDependencyCount === 1 ? "y" : "ies"} for ongoing operation. ` +
      "Never a substitute for a real hosting or usage quote before any real spend.",
  };
}

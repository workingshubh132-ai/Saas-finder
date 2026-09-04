/**
 * Deterministic, founder-revisable launch budget ceiling
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §27) — the same "a founder-revisable
 * number like every other budget in this codebase" discipline as
 * DEFAULT_EXECUTION_BUDGET/DEFAULT_DECISION_CYCLE_BUDGET, never a
 * database-editable value in this milestone. Checked against a
 * PricingModel's own unit economics at DeploymentPlan/BillingPlan PLAN
 * time — a deterministic input factor the CEO/Chairman weigh, never a
 * Guardian permission.
 */
const DEFAULT_MONTHLY_COST_CEILING_USD = 200;

export interface LaunchBudgetCheckInput {
  estimatedMonthlyCostUsd: number;
  ceilingUsd?: number;
}

export interface LaunchBudgetCheckResult {
  budgetExceeded: boolean;
  estimatedMonthlyCostUsd: number;
  ceilingUsd: number;
  reasoning: string;
}

export function checkLaunchBudget(input: LaunchBudgetCheckInput): LaunchBudgetCheckResult {
  const ceilingUsd = input.ceilingUsd ?? DEFAULT_MONTHLY_COST_CEILING_USD;
  const budgetExceeded = input.estimatedMonthlyCostUsd > ceilingUsd;
  return {
    budgetExceeded,
    estimatedMonthlyCostUsd: input.estimatedMonthlyCostUsd,
    ceilingUsd,
    reasoning: budgetExceeded
      ? `Estimated monthly operating cost $${input.estimatedMonthlyCostUsd.toFixed(2)} exceeds the founder-configured ceiling of $${ceilingUsd.toFixed(2)} — must be surfaced to the CEO and Chairman before a human may approve this launch.`
      : `Estimated monthly operating cost $${input.estimatedMonthlyCostUsd.toFixed(2)} is within the founder-configured ceiling of $${ceilingUsd.toFixed(2)}.`,
  };
}

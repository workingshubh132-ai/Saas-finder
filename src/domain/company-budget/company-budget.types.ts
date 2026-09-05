/**
 * Company-level cost control (docs/M9_ARCHITECTURE_PROPOSAL.md §50, M9
 * brief §38) — a ROLLUP check sitting above the three existing
 * ceilings (AgentExecution's own ExecutionBudget, ResearchCycle/
 * DecisionCycle's own maxCostUsd, M7's checkLaunchBudget), never a
 * fourth independent one. Bounds model/agent execution cost only —
 * there is no code path in this codebase, M1-M9 alike, that spends
 * real money.
 */
export const DEFAULT_COMPANY_BUDGET_CEILING_USD = 50;

export interface CompanyBudgetCheckInput {
  readonly consumedUsd: number;
  readonly ceilingUsd?: number;
}

export interface CompanyBudgetCheckResult {
  readonly exceeded: boolean;
  readonly consumedUsd: number;
  readonly ceilingUsd: number;
  readonly reasoning: string;
}

export function checkCompanyBudget(input: CompanyBudgetCheckInput): CompanyBudgetCheckResult {
  const ceilingUsd = input.ceilingUsd ?? DEFAULT_COMPANY_BUDGET_CEILING_USD;
  const exceeded = input.consumedUsd > ceilingUsd;
  return {
    exceeded,
    consumedUsd: input.consumedUsd,
    ceilingUsd,
    reasoning: exceeded
      ? `Company-wide period spend $${input.consumedUsd.toFixed(2)} exceeds the founder-configured ceiling of $${ceilingUsd.toFixed(2)} — the operating cycle stops here rather than proceeding to its next stage.`
      : `Company-wide period spend $${input.consumedUsd.toFixed(2)} is within the founder-configured ceiling of $${ceilingUsd.toFixed(2)}.`,
  };
}

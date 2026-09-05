import type { CompanyBudget } from "@prisma/client";
import { agentExecutionRepository } from "../db/repositories/agent-execution.repository.js";
import { companyBudgetRepository } from "../db/repositories/company-budget.repository.js";
import { checkCompanyBudget, DEFAULT_COMPANY_BUDGET_CEILING_USD, type CompanyBudgetCheckResult } from "../domain/company-budget/company-budget.types.js";
import { currentPeriod } from "../domain/shared/company-period.js";

function periodStart(period: string): Date {
  const [yearStr, weekStr] = period.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(firstThursday);
  firstMonday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7));
  firstMonday.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
  return firstMonday;
}

/**
 * Cost control's own rollup check (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §50) — sits ABOVE the three existing ceilings (AgentExecution's own
 * ExecutionBudget, ResearchCycle/DecisionCycle's own maxCostUsd, M7's
 * checkLaunchBudget), never a fourth independent one. Sums
 * `AgentExecution.estimatedCostUsd` for the current period; the caller
 * (`schedulerService`'s stage-advance) is responsible for actually
 * stopping the cycle when this reports `exceeded` — this service only
 * computes and persists the rollup, it never itself mutates an
 * OperatingCycle.
 */
export const companyBudgetService = {
  async getOrCreateForPeriod(period: string, ceilingUsd: number = DEFAULT_COMPANY_BUDGET_CEILING_USD): Promise<CompanyBudget> {
    const existing = await companyBudgetRepository.findByPeriod(period);
    if (existing) return existing;
    return companyBudgetRepository.create({ period, ceilingUsd });
  },

  async assertNotExceeded(now: Date = new Date()): Promise<CompanyBudgetCheckResult> {
    const period = currentPeriod(now);
    const budget = await this.getOrCreateForPeriod(period);

    const executions = await agentExecutionRepository.listCreatedSince(periodStart(period));
    const consumedUsd = executions.reduce((sum, e) => sum + (e.estimatedCostUsd ?? 0), 0);
    await companyBudgetRepository.setConsumed(period, consumedUsd);

    return checkCompanyBudget({ consumedUsd, ceilingUsd: budget.ceilingUsd });
  },

  list: companyBudgetRepository.list,
};

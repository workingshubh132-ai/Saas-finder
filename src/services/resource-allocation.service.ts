import type { ResourceAllocation } from "@prisma/client";
import { agentExecutionRepository } from "../db/repositories/agent-execution.repository.js";
import { resourceAllocationRepository } from "../db/repositories/resource-allocation.repository.js";
import { isResourceCategory, type ResourceCategory } from "../domain/resource-allocation/resource-allocation.types.js";
import { currentPeriod } from "../domain/shared/company-period.js";
import { ValidationError } from "../domain/shared/errors.js";

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

export interface SetAllocationParams {
  category: ResourceCategory;
  period?: string;
  productId?: string | null;
  allocated: number;
}

export interface RecordConsumptionParams {
  category: ResourceCategory;
  period?: string;
  productId?: string | null;
  consumed: number;
}

/**
 * Resource Allocation (docs/M9_ARCHITECTURE_PROPOSAL.md §23, M9 brief
 * §11) — a READ+REPORT table only, per RESOURCE_UNIT_DEFINITIONS's own
 * documented per-category unit meaning; never a currency amount, never
 * a write path that touches BusinessMetric/BillingAccount/any EXECUTE
 * step. `AGENT_EXECUTION` is computed automatically here (the one
 * category with an already-clean, already-built date-range read,
 * shared with `companyBudgetService`); the other four categories are
 * recorded via `recordConsumption` by whichever caller already knows
 * the real count (a human, or a future orchestrator) — real numbers
 * either way, never fabricated ones.
 */
export const resourceAllocationService = {
  async setAllocation(params: SetAllocationParams): Promise<ResourceAllocation> {
    if (!isResourceCategory(params.category)) throw new ValidationError(`Unknown resource category: ${params.category}`);
    const period = params.period ?? currentPeriod();
    const existing = await resourceAllocationRepository.findOne(params.category, period, params.productId ?? null);
    if (existing) return resourceAllocationRepository.update(existing.id, { allocated: params.allocated });
    return resourceAllocationRepository.create({ category: params.category, period, productId: params.productId ?? null, allocated: params.allocated, consumed: 0 });
  },

  async recordConsumption(params: RecordConsumptionParams): Promise<ResourceAllocation> {
    if (!isResourceCategory(params.category)) throw new ValidationError(`Unknown resource category: ${params.category}`);
    const period = params.period ?? currentPeriod();
    const existing = await resourceAllocationRepository.findOne(params.category, period, params.productId ?? null);
    if (existing) return resourceAllocationRepository.update(existing.id, { consumed: params.consumed });
    return resourceAllocationRepository.create({ category: params.category, period, productId: params.productId ?? null, allocated: 0, consumed: params.consumed });
  },

  /** RESOURCE_UNIT_DEFINITIONS.AGENT_EXECUTION: "AgentExecution row count in the period" — computed, never asked for. */
  async recordAgentExecutionConsumption(period: string = currentPeriod()): Promise<ResourceAllocation> {
    const executions = await agentExecutionRepository.listCreatedSince(periodStart(period));
    return this.recordConsumption({ category: "AGENT_EXECUTION", period, consumed: executions.length });
  },

  getForPeriod(period: string = currentPeriod()): Promise<ResourceAllocation[]> {
    return resourceAllocationRepository.listForPeriod(period);
  },
};

/**
 * Resource Allocation (docs/M9_ARCHITECTURE_PROPOSAL.md §23, M9 brief
 * §11) — the brief's own five categories, verbatim. Units are an
 * abstract, per-category-documented count, NEVER a currency amount —
 * no real financial data exists anywhere in this system to allocate
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §21's own Company State table).
 * Actual financial allocation remains behind the existing
 * human-controlled EXECUTE steps (M7) — this table has no write path
 * that touches BusinessMetric, BillingAccount, or any EXECUTE step.
 */
export const RESOURCE_CATEGORIES = ["ENGINEERING", "MARKETING", "RESEARCH", "AGENT_EXECUTION", "FOUNDER_ATTENTION"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export function isResourceCategory(value: string): value is ResourceCategory {
  return (RESOURCE_CATEGORIES as readonly string[]).includes(value);
}

/** What one "unit" means per category — documented, never left implicit. */
export const RESOURCE_UNIT_DEFINITIONS: Readonly<Record<ResourceCategory, string>> = {
  ENGINEERING: "EngineeringTask rows assigned in the period",
  MARKETING: "GoToMarketPlan experiment specs + GrowthExperiment rows started in the period",
  RESEARCH: "ResearchQueueItem rows worked in the period",
  AGENT_EXECUTION: "AgentExecution row count in the period",
  FOUNDER_ATTENTION: "sum of FounderAttentionScore items actually reviewed (decided) in the period",
};

export interface ResourceAllocationInput {
  readonly category: ResourceCategory;
  readonly allocated: number;
  readonly consumed: number;
}

/** Consumption over allocation, clamped — never negative, never a divide-by-zero NaN. */
export function computeUtilization(input: ResourceAllocationInput): number {
  if (input.allocated <= 0) return input.consumed > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, input.consumed / input.allocated));
}

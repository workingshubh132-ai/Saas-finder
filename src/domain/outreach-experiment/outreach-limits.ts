/**
 * Founder-configurable, conservative default rate limits
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §26, brief §15) — layered like
 * every other M2-M4 budget (ExecutionBudget, ResearchCycleBudget,
 * DecisionCycleBudget): checked in code BEFORE the next Prospect/
 * OutreachMessage is created, never after. No unlimited-outreach code
 * path exists anywhere in this codebase.
 */
export interface OutreachLimits {
  readonly maxProspectsPerExperiment: number;
  readonly maxMessagesPerExperimentPerDay: number;
  /** Per contact-channel domain — bounds how many messages target the same public channel/organization in one day. */
  readonly maxMessagesPerDestinationSourcePerDay: number;
  readonly maxActiveExperimentsPerOpportunity: number;
}

export const DEFAULT_OUTREACH_LIMITS: OutreachLimits = {
  maxProspectsPerExperiment: 25,
  maxMessagesPerExperimentPerDay: 10,
  maxMessagesPerDestinationSourcePerDay: 5,
  maxActiveExperimentsPerOpportunity: 3,
};

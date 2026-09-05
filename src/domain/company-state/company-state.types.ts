import type { MetricResult } from "../shared/metric-result.js";

/**
 * Company State (docs/M9_ARCHITECTURE_PROPOSAL.md §21, M9 brief §9) —
 * every dimension is a MetricResult (reused from M8, unmodified), so
 * "unknown must remain unknown" is a type-level guarantee: a caller is
 * structurally required to handle the UNKNOWN case, never free to
 * default it to 0. Cash position is permanently UNKNOWN in this
 * milestone — no real payment processor exists anywhere in this
 * codebase (M7 §59) — never estimated.
 */
export interface CompanyStateDimensions {
  readonly cashPosition: MetricResult;
  readonly revenue: MetricResult;
  readonly growth: MetricResult;
  readonly portfolioSize: number;
  readonly portfolioHealth: MetricResult;
  readonly customerHealth: MetricResult;
  readonly operationalHealth: MetricResult;
  readonly risk: MetricResult;
  readonly evidenceQuality: MetricResult;
  readonly decisionBacklog: number;
  readonly executionBacklog: number;
}

/**
 * Portfolio Control's six buckets (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §22, M9 brief §10) — Constitution §19's own vocabulary restated for
 * a company-wide READ, never a new scoring system. Mapped directly
 * from BusinessHealth.state (M8, reused unmodified) by
 * mapBusinessHealthToPortfolioBucket below — the identical mapping
 * buildDevPortfolioAnalystFixture (M8) already encodes for its own
 * Constitution §19 recommendation, reused as a pure function rather
 * than duplicated.
 */
export const PORTFOLIO_BUCKETS = ["WINNERS", "PROMISING", "UNCERTAIN", "STAGNATING", "DECLINING", "KILL_CANDIDATES"] as const;
export type PortfolioBucket = (typeof PORTFOLIO_BUCKETS)[number];

export function isPortfolioBucket(value: string): value is PortfolioBucket {
  return (PORTFOLIO_BUCKETS as readonly string[]).includes(value);
}

/**
 * BusinessHealth.state is one of BUSINESS_HEALTH_STATES (M8):
 * UNKNOWN/EARLY/PROMISING/HEALTHY/STAGNATING/DECLINING/CRITICAL. Every
 * one of those seven maps to exactly one of PORTFOLIO_BUCKETS' six —
 * HEALTHY is the only state mapping to WINNERS, matching the M8 dev
 * fixture's own HEALTHY -> SCALE rule.
 */
export function mapBusinessHealthToPortfolioBucket(state: string): PortfolioBucket {
  switch (state) {
    case "HEALTHY":
      return "WINNERS";
    case "PROMISING":
      return "PROMISING";
    case "STAGNATING":
      return "STAGNATING";
    case "DECLINING":
      return "DECLINING";
    case "CRITICAL":
      return "KILL_CANDIDATES";
    case "EARLY":
    case "UNKNOWN":
    default:
      return "UNCERTAIN";
  }
}

/** One line of the Opportunity Pipeline read (docs/M9_ARCHITECTURE_PROPOSAL.md §24). */
export const OPPORTUNITY_PIPELINE_STAGES = ["SOURCE", "SIGNAL", "CLUSTER", "PROBLEM", "OPPORTUNITY", "VALIDATION", "DECISION", "PRODUCT"] as const;
export type OpportunityPipelineStage = (typeof OPPORTUNITY_PIPELINE_STAGES)[number];

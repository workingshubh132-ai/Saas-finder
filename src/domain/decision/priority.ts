/**
 * The CEO's cross-opportunity decision-priority formula
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §14) — a documented weighted sum
 * covering all eight factors the M4 brief names, same "check the
 * formula, not a black box" shape as `domain/research-queue/priority.ts`.
 * Deliberately unbounded / can go negative — a low-scoring,
 * high-kill-risk, expensive-to-research opportunity should sort to the
 * bottom of "what needs a decision cycle next," not get floored to an
 * uninformative 0.
 */
export interface DecisionPriorityInput {
  /** The opportunity's current attractiveness score, 0..1. */
  opportunityScore: number;
  /** The opportunity's current confidence score, 0..1 — low confidence raises priority to resolve uncertainty. */
  confidenceScore: number;
  /** The opportunity's current kill-risk score, 0..1 — high risk raises priority to confirm/kill fast. */
  killRiskScore: number;
  /** The single highest-impact unresolved EvidenceGap's impactScore, 0..1. */
  topEvidenceGapImpactScore: number;
  /** The single highest Expected Information Gain across this opportunity's claims (domain/claim/eig.ts). */
  maxClaimEIG: number;
  /** 0..1 placeholder — same documented gap as research-queue's `estimatedResearchCost` (docs/DECISIONS.md). */
  estimatedResearchCost: number;
  /**
   * 0..1 placeholder — no numeric urgency field exists anywhere in the
   * schema (`Problem.urgency` is free text, not a number). Defaults to
   * a neutral 0.5 until a future milestone defines this concretely;
   * see docs/M4_ARCHITECTURE_PROPOSAL.md §14.
   */
  timeSensitivityScore: number;
  /**
   * 0..1 placeholder — no portfolio-strategy concept exists in M1-M4's
   * scope. Defaults to 0.5, weighted smallest on purpose (§14).
   */
  strategicFitScore: number;
}

const WEIGHT_OPPORTUNITY_SCORE = 0.2;
const WEIGHT_CONFIDENCE_GAP = 0.15;
const WEIGHT_KILL_RISK = 0.2;
const WEIGHT_EVIDENCE_GAP = 0.15;
const WEIGHT_EIG = 0.15;
const WEIGHT_RESEARCH_COST = 0.1;
const WEIGHT_TIME_SENSITIVITY = 0.1;
const WEIGHT_STRATEGIC_FIT = 0.05;

/** Neutral default for the two honest placeholders (§14) — never fabricated precision. */
export const PLACEHOLDER_NEUTRAL_SCORE = 0.5;

export function computeDecisionPriority(input: DecisionPriorityInput): number {
  return (
    WEIGHT_OPPORTUNITY_SCORE * input.opportunityScore +
    WEIGHT_CONFIDENCE_GAP * (1 - input.confidenceScore) +
    WEIGHT_KILL_RISK * input.killRiskScore +
    WEIGHT_EVIDENCE_GAP * input.topEvidenceGapImpactScore +
    WEIGHT_EIG * input.maxClaimEIG -
    WEIGHT_RESEARCH_COST * input.estimatedResearchCost +
    WEIGHT_TIME_SENSITIVITY * input.timeSensitivityScore +
    WEIGHT_STRATEGIC_FIT * input.strategicFitScore
  );
}

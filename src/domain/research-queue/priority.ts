/**
 * The research queue's priority formula (M3 brief Part 30-31;
 * docs/M3_ARCHITECTURE_PROPOSAL.md §13) — documented weights, not
 * hidden. Resolving the single largest uncertainty on a promising,
 * low-kill-risk opportunity should outrank blindly re-researching
 * whatever currently scores highest.
 *
 * Deliberately NOT clamped to [0, 1] or non-negative: a costly item on
 * a low-scoring, high-kill-risk opportunity can and should land below
 * zero, so it sorts to the bottom rather than being floored to an
 * uninformative 0 alongside genuinely marginal items.
 */
export interface PriorityInput {
  /** The evidence gap's own impact score, 0..1 (evidence-gap.service.ts). */
  informationGain: number;
  /** The opportunity's current attractiveness score, 0..1. */
  opportunityScore: number;
  /** The opportunity's current kill-risk score, 0..1 — higher risk lowers priority to deepen research further. */
  killRiskScore: number;
  /** A rough, documented placeholder cost per queue item, 0..1 — no real per-item cost model exists yet (see docs/DECISIONS.md). */
  estimatedResearchCost: number;
}

const WEIGHT_INFORMATION_GAIN = 0.4;
const WEIGHT_OPPORTUNITY_SCORE = 0.3;
const WEIGHT_KILL_RISK = 0.2;
const WEIGHT_COST = 0.1;

export function computeQueuePriority(input: PriorityInput): number {
  return (
    WEIGHT_INFORMATION_GAIN * input.informationGain +
    WEIGHT_OPPORTUNITY_SCORE * input.opportunityScore -
    WEIGHT_KILL_RISK * input.killRiskScore -
    WEIGHT_COST * input.estimatedResearchCost
  );
}

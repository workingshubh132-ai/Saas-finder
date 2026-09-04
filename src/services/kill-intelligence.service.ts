import { DeterministicKillRiskScorer, type KillRiskDimensions, type KillRiskScorer } from "./kill-risk-scorer.js";

/**
 * Reuses M4's existing kill-risk scorer directly — no second,
 * independent kill-score architecture (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §27, M8 brief §27's own explicit instruction). Combines it with real
 * post-launch business evidence (BusinessHealth's own dimensions)
 * rather than re-litigating pre-launch opportunity signals a second
 * time.
 */
const scorer: KillRiskScorer = new DeterministicKillRiskScorer();

export const KILL_INTELLIGENCE_RECOMMENDATIONS = ["CONTINUE", "INVESTIGATE", "REDUCE_INVESTMENT", "PREPARE_KILL_REVIEW"] as const;
export type KillIntelligenceRecommendation = (typeof KILL_INTELLIGENCE_RECOMMENDATIONS)[number];

export interface KillIntelligenceInput {
  /** The product's own original opportunity-stage kill risk (0 if never scored). */
  readonly priorOpportunityKillRiskScore: number;
  readonly retentionHealth: number;
  readonly revenueHealth: number;
  readonly growthHealth: number;
  readonly marginHealth: number;
  readonly evidenceConfidence: number;
}

export interface KillIntelligenceResult {
  readonly recommendation: KillIntelligenceRecommendation;
  readonly combinedKillRiskScore: number;
  readonly reasons: readonly string[];
}

/**
 * Only 5 of the scorer's 11 dimensions ever carry a real M8 signal —
 * crowdedMarket/poorDifferentiation/technicalDifficulty/regulatoryRisk/
 * platformDependency are pre-launch-only concepts with no post-launch
 * signal and stay fixed at 0 (see the dimensions object below). Their
 * combined weight (0.41 of the scorer's 1.0) is therefore always
 * unearned risk, capping scored.killRiskScore at 0.59 and the
 * PRIOR_WEIGHT/OBSERVED_WEIGHT blend below at ≈0.713 even in the
 * worst-possible case (prior=1, every populated dimension=1). Ceilings
 * are calibrated against that real 0..0.713 achievable range, not a
 * hypothetical full 0..1 spread — otherwise PREPARE_KILL_REVIEW would
 * be mathematically unreachable under any input.
 */
const CONTINUE_CEILING = 0.25;
const INVESTIGATE_CEILING = 0.4;
const REDUCE_INVESTMENT_CEILING = 0.55;

/** Post-launch reality dominates a stale pre-launch projection — 70/30, documented and founder-revisable. */
const OBSERVED_WEIGHT = 0.7;
const PRIOR_WEIGHT = 0.3;

export const killIntelligenceService = {
  assess(input: KillIntelligenceInput): KillIntelligenceResult {
    const dimensions: KillRiskDimensions = {
      weakDemand: 1 - input.growthHealth,
      weakWillingnessToPay: 1 - input.revenueHealth,
      crowdedMarket: 0,
      poorDifferentiation: 0,
      badDistribution: 1 - input.growthHealth,
      technicalDifficulty: 0,
      regulatoryRisk: 0,
      platformDependency: 0,
      lowRetention: 1 - input.retentionHealth,
      lowMargins: 1 - input.marginHealth,
      insufficientEvidence: 1 - input.evidenceConfidence,
    };
    const scored = scorer.score(dimensions);
    const combinedKillRiskScore = Math.min(1, Math.max(0, PRIOR_WEIGHT * input.priorOpportunityKillRiskScore + OBSERVED_WEIGHT * scored.killRiskScore));

    const reasons = [...scored.killRiskReasons];
    if (input.priorOpportunityKillRiskScore >= 0.5) {
      reasons.push(`This product's original opportunity-stage kill risk was already elevated (${input.priorOpportunityKillRiskScore.toFixed(2)}).`);
    }

    const recommendation: KillIntelligenceRecommendation =
      combinedKillRiskScore >= REDUCE_INVESTMENT_CEILING
        ? "PREPARE_KILL_REVIEW"
        : combinedKillRiskScore >= INVESTIGATE_CEILING
          ? "REDUCE_INVESTMENT"
          : combinedKillRiskScore >= CONTINUE_CEILING
            ? "INVESTIGATE"
            : "CONTINUE";

    return { recommendation, combinedKillRiskScore, reasons };
  },
};

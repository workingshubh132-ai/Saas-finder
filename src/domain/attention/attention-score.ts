/**
 * Founder Attention Score (docs/M9_ARCHITECTURE_PROPOSAL.md §18, M9
 * brief §5-6) — "founder attention is a scarce resource." A
 * documented, weighted sum over NINE stored factors, each 0..1, never
 * one unexplained magic number: every factor AND the underlying
 * resource ids are stored on FounderAttentionItem, not just the
 * composite. Weights are a founder-revisable constant, the same
 * pattern HEALTH_WEIGHTS/BUSINESS_ACTION_PRIORITY_WEIGHTS (M8) already
 * established.
 */
export interface FounderAttentionFactors {
  readonly financialImpact: number;
  readonly urgency: number;
  readonly risk: number;
  readonly uncertainty: number;
  readonly reversibility: number;
  readonly opportunityCost: number;
  readonly evidenceQuality: number;
  readonly strategicImportance: number;
  readonly deadlineProximity: number;
}

export const ATTENTION_SCORE_WEIGHTS: Readonly<Record<keyof FounderAttentionFactors, number>> = {
  financialImpact: 0.18,
  urgency: 0.14,
  risk: 0.14,
  uncertainty: 0.1,
  reversibility: 0.12,
  opportunityCost: 0.1,
  evidenceQuality: 0.08,
  strategicImportance: 0.1,
  deadlineProximity: 0.04,
} as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertUnitInterval(factors: FounderAttentionFactors): void {
  for (const [key, value] of Object.entries(factors)) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new Error(`[attention-score] factor "${key}" must be a number between 0 and 1 (got ${String(value)})`);
    }
  }
}

/**
 * reversibility is inverted at the call site (a HIGHLY reversible item
 * should score LOWER attention, not higher) — callers pass
 * `1 - reversibilityOfTheAction` as this factor so every factor in
 * this formula shares the same "higher = more attention-worthy"
 * polarity, matching KillRiskDimensions' own single-polarity
 * discipline (M3/M4) rather than mixing directions silently.
 */
export function computeFounderAttentionScore(factors: FounderAttentionFactors): number {
  assertUnitInterval(factors);
  const raw =
    ATTENTION_SCORE_WEIGHTS.financialImpact * factors.financialImpact +
    ATTENTION_SCORE_WEIGHTS.urgency * factors.urgency +
    ATTENTION_SCORE_WEIGHTS.risk * factors.risk +
    ATTENTION_SCORE_WEIGHTS.uncertainty * factors.uncertainty +
    ATTENTION_SCORE_WEIGHTS.reversibility * factors.reversibility +
    ATTENTION_SCORE_WEIGHTS.opportunityCost * factors.opportunityCost +
    ATTENTION_SCORE_WEIGHTS.evidenceQuality * factors.evidenceQuality +
    ATTENTION_SCORE_WEIGHTS.strategicImportance * factors.strategicImportance +
    ATTENTION_SCORE_WEIGHTS.deadlineProximity * factors.deadlineProximity;
  return clamp01(raw);
}

/**
 * A small, documented lookup by DecisionQueueEntry KIND — the
 * underlying ApprovalRequest.resourceType (OUTREACH_MESSAGE,
 * DEPLOYMENT_PLAN, BILLING_PLAN, GROWTH_EXPERIMENT) for
 * APPROVAL_REQUEST entries, or the entry's own `source`
 * (MemoQueueSource | "COMPANY_RECOMMENDATION",
 * `src/domain/decision-queue/decision-queue.types.ts`) for MEMO/
 * COMPANY_RECOMMENDATION entries — never `DecisionQueueEntry.resourceType`
 * itself, which names what the decision TARGETS (OPPORTUNITY/PRODUCT),
 * not what KIND of decision it is (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §18's own table). Value is "how reversible is undoing this
 * resource's own consequential action" (HIGH=1, MEDIUM=0.5, LOW=0);
 * callers invert it (1 - value) to get the attention-score factor,
 * per this file's own polarity discipline above.
 */
export const REVERSIBILITY_BY_RESOURCE_TYPE: Readonly<Record<string, number>> = {
  OUTREACH_MESSAGE: 0.5,
  DEPLOYMENT_PLAN: 0.5,
  BILLING_PLAN: 0.25,
  GROWTH_EXPERIMENT: 1,
  INVESTMENT_MEMO: 0.5,
  CUSTOMER_DISCOVERY_MEMO: 0.75,
  PRODUCT_REVIEW_MEMO: 0.5,
  LAUNCH_REVIEW_MEMO: 0.25,
  BUSINESS_REVIEW_MEMO: 0.25,
  COMPANY_RECOMMENDATION: 0.5,
} as const;

export const DEFAULT_REVERSIBILITY = 0.5;

/** Pass a DecisionQueueEntry's `source` (or the underlying ApprovalRequest.resourceType) — see this table's own doc comment. */
export function reversibilityFor(source: string): number {
  return REVERSIBILITY_BY_RESOURCE_TYPE[source] ?? DEFAULT_REVERSIBILITY;
}

/** No genuinely important decision below this composite ever needs a briefing entry (M9 brief §36 — NO_ACTION_REQUIRED is a valid output). */
export const MIN_ATTENTION_SCORE_FOR_BRIEFING = 0.35;

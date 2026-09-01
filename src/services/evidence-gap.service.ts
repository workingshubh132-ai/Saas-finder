import type { EvidenceGap } from "@prisma/client";
import type { DimensionGrounding } from "../domain/evidence-gap/dimension-grounding.js";
import { evidenceGapRepository } from "../db/repositories/evidence-gap.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { auditService } from "./audit.service.js";
import type { OpportunityScoreDimensions } from "./opportunity-scorer.js";

/** Natural-language research question per known dimension — falls back
 *  to a generic template for a dimension name outside this set (M3
 *  brief Part 31). */
const RESEARCH_QUESTION_TEMPLATES: Partial<Record<keyof OpportunityScoreDimensions, string>> = {
  pain: "What direct evidence confirms this pain is real and significant for the target customer?",
  demand: "What evidence shows multiple, independent customers actually want this solved?",
  willingnessToPay: "Find evidence of businesses currently paying for this workflow, or a comparable one.",
  reachability: "How would we concretely reach the first 10 customers, and what evidence supports that channel?",
  retention: "What evidence suggests customers would keep using this over time rather than churn?",
  differentiation: "What would make this meaningfully different from existing alternatives, backed by evidence?",
  buildability: "What technical unknowns remain about actually building this?",
  economics: "What evidence exists about the achievable price point and cost to serve?",
  marketSize: "How large is the addressable customer segment, with real evidence?",
  frequency: "How often does this pain actually recur for an affected customer?",
  evidenceIndependence: "Find corroborating evidence from a genuinely independent source (a different thread, author, or platform).",
  timing: "What evidence suggests now is a meaningfully better time for this than before?",
};

function researchQuestionFor(dimension: string): string {
  return RESEARCH_QUESTION_TEMPLATES[dimension as keyof OpportunityScoreDimensions] ?? `What evidence would resolve the uncertainty around "${dimension}"?`;
}

/** Uniform weight across all 14 scoring dimensions (docs/M3_ARCHITECTURE_PROPOSAL.md
 *  §14) — a simple, documented, founder-revisable starting point,
 *  not a claim that every dimension matters equally in every case. */
const DIMENSION_COUNT = 14;
const UNIFORM_WEIGHT = 1 / DIMENSION_COUNT;

/**
 * A dimension assumed at an extreme value (near 0 or 1) carries more
 * risk if wrong than one assumed near a neutral midpoint — a wrong
 * extreme assumption is more likely to flip the eventual decision.
 */
function computeImpactScore(weight: number, assumedValue: number): number {
  const extremity = Math.abs(assumedValue - 0.5); // 0..0.5
  return weight * (0.5 + extremity);
}

/**
 * The evidence-gap engine (M3 brief Part 31): turns the Opportunity
 * Analyst's per-dimension EVIDENCED/ASSUMED tags into persisted,
 * ranked EvidenceGap rows and a single denormalized
 * `nextBestResearchQuestion` on the Opportunity — "resolve the single
 * uncertainty most likely to change the decision," not always "keep
 * researching the highest-scoring opportunity."
 */
export const evidenceGapService = {
  async analyze(opportunityId: string, grounding: DimensionGrounding, dimensions: OpportunityScoreDimensions): Promise<EvidenceGap[]> {
    const assumed = grounding.filter((entry) => entry.status === "ASSUMED");

    const gaps: EvidenceGap[] = [];
    for (const entry of assumed) {
      const assumedValue = dimensions[entry.dimension as keyof OpportunityScoreDimensions] ?? 0.5;
      const gap = await evidenceGapRepository.create({
        opportunityId,
        dimension: entry.dimension,
        status: "ASSUMPTION",
        description: entry.reasoning,
        suggestedResearchQuestion: researchQuestionFor(entry.dimension),
        impactScore: computeImpactScore(UNIFORM_WEIGHT, assumedValue),
      });
      gaps.push(gap);
    }

    const [topGap] = [...gaps].sort((a, b) => b.impactScore - a.impactScore);
    await opportunityRepository.update(opportunityId, { nextBestResearchQuestion: topGap?.suggestedResearchQuestion ?? null });

    // Audited (not a domain event, matching M1/M2's own selectivity —
    // not every audited action also gets an event): the Opportunity's
    // own audit trail already records SCORE_OPPORTUNITY at the same
    // moment; this is the gap-analysis-specific detail alongside it.
    await auditService.record({
      actorType: "SYSTEM",
      actorId: null,
      action: "EVIDENCE_GAP_ANALYSIS",
      resourceType: "OPPORTUNITY",
      resourceId: opportunityId,
      result: "SUCCESS",
      metadata: { gapCount: gaps.length, topGapDimension: topGap?.dimension ?? null },
    });

    return gaps;
  },

  listForOpportunity: evidenceGapRepository.listForOpportunity,

  async resolve(gapId: string, resolvedByEvidenceId: string | null): Promise<EvidenceGap> {
    return evidenceGapRepository.resolve(gapId, resolvedByEvidenceId);
  },
};

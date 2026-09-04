import type { Claim, EvidenceGap } from "@prisma/client";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { competitorRepository } from "../db/repositories/competitor.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { CLAIM_TYPES, CLAIM_TYPE_IMPORTANCE, type ClaimType } from "../domain/claim/claim.types.js";
import { fromJsonString } from "../domain/shared/json.js";
import { auditService } from "./audit.service.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import type { OpportunityScoreDimensions } from "./opportunity-scorer.js";
import { claimService } from "./claim.service.js";

/**
 * Deterministic claim extraction (docs/M4_ARCHITECTURE_PROPOSAL.md §3,
 * §29) — no model call. Every claim's statement traces to a field
 * VentureForge already computed through real, evidence-grounded
 * reasoning (Problem/Opportunity/CompetitorObservation/EvidenceGap) —
 * asking a second model to re-derive claims from the first model's own
 * output would add a fabrication surface without adding information.
 */

const DIMENSION_CLAIM_TYPES: Readonly<Partial<Record<ClaimType, keyof OpportunityScoreDimensions>>> = {
  MARKET_SIZE: "marketSize",
  DIFFERENTIATION: "differentiation",
  RETENTION: "retention",
  BUILDABILITY: "buildability",
  TIMING: "timing",
  ECONOMICS: "economics",
};

/** A prior, not a verdict — always superseded once a ValidationReport exists (§11). */
const ASSUMPTION_PRIOR_CONFIDENCE = 0.2;
const NO_DATA_PRIOR_CONFIDENCE = 0;
const FALLBACK_FIELD_PRIOR_CONFIDENCE = 0.3;

interface ExtractedClaimInput {
  claimType: ClaimType;
  statement: string;
  extractedFrom: string | null;
  confidence: number;
}

function dimensionLabel(dimension: keyof OpportunityScoreDimensions): string {
  return dimension.replace(/([A-Z])/g, " $1").toLowerCase();
}

/**
 * Shared by the six claim types that map 1:1 onto a scored
 * OpportunityScoreDimensions key: prefer the real ASSUMED-dimension
 * reasoning an EvidenceGap already recorded (dimensionGrounding's own
 * text, docs/M3_ARCHITECTURE_PROPOSAL.md §14); otherwise state the
 * real scored value directly — never invents new text either way.
 */
function dimensionClaim(
  claimType: ClaimType,
  dimension: keyof OpportunityScoreDimensions,
  dimensions: OpportunityScoreDimensions | null,
  gapByDimension: ReadonlyMap<string, EvidenceGap>,
  opportunityConfidence: number,
): ExtractedClaimInput {
  const gap = gapByDimension.get(dimension);
  if (gap) {
    return { claimType, statement: gap.description, extractedFrom: `EVIDENCE_GAP.${dimension}`, confidence: ASSUMPTION_PRIOR_CONFIDENCE };
  }
  const value = dimensions?.[dimension];
  if (typeof value === "number") {
    return {
      claimType,
      statement: `${dimensionLabel(dimension)} scored ${value.toFixed(2)}/1.00 from directly evidenced input, with no unresolved assumption recorded for this dimension.`,
      extractedFrom: `OPPORTUNITY_SCORE_RECORD.dimensions.${dimension}`,
      confidence: opportunityConfidence,
    };
  }
  return {
    claimType,
    statement: `No scored data available yet for ${dimensionLabel(dimension)}.`,
    extractedFrom: null,
    confidence: NO_DATA_PRIOR_CONFIDENCE,
  };
}

export const claimExtractionService = {
  /**
   * Idempotent, mirroring `promoteSignalsToEvidence`'s own guard
   * (opportunity-analyst.service.ts): an opportunity already extracted
   * returns its existing claims unchanged rather than duplicating them
   * — safe to call at the start of every decision cycle (§16).
   */
  async extractForOpportunity(params: { opportunityId: string; actorType: ActorType; actorId: string | null }): Promise<Claim[]> {
    const existing = await claimRepository.listForOpportunity(params.opportunityId);
    if (existing.length > 0) return existing;

    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new Error(`Opportunity ${params.opportunityId} not found`);

    const problem = opportunity.problemId ? await problemRepository.findById(opportunity.problemId) : null;
    const competitorObservations = problem ? await competitorRepository.listObservationsForProblem(problem.id) : [];
    const gaps = await evidenceGapService.listForOpportunity(opportunity.id);
    const gapByDimension = new Map(gaps.filter((gap) => gap.status !== "RESOLVED").map((gap) => [gap.dimension, gap] as const));

    const scoreRecords = await opportunityRepository.listScoreRecords(opportunity.id);
    const dimensions = scoreRecords[0] ? fromJsonString<OpportunityScoreDimensions | null>(scoreRecords[0].dimensions, null) : null;
    const opportunityConfidence = opportunity.confidenceScore ?? FALLBACK_FIELD_PRIOR_CONFIDENCE;

    const metadata = fromJsonString<{ distributionChannels?: Array<{ channel: string; reasoning: string }> }>(opportunity.metadata, {});
    const distributionChannels = metadata.distributionChannels ?? [];

    const inputs: ExtractedClaimInput[] = CLAIM_TYPES.map((claimType): ExtractedClaimInput => {
      switch (claimType) {
        case "CUSTOMER_PROBLEM":
          return problem
            ? { claimType, statement: `${problem.statement} (pain: ${problem.pain})`, extractedFrom: "PROBLEM.statement", confidence: opportunityConfidence }
            : { claimType, statement: opportunity.problem, extractedFrom: "OPPORTUNITY.problem", confidence: FALLBACK_FIELD_PRIOR_CONFIDENCE };

        case "CUSTOMER_SEGMENT":
          return problem
            ? { claimType, statement: problem.customerSegment, extractedFrom: "PROBLEM.customerSegment", confidence: opportunityConfidence }
            : { claimType, statement: opportunity.targetCustomer, extractedFrom: "OPPORTUNITY.targetCustomer", confidence: FALLBACK_FIELD_PRIOR_CONFIDENCE };

        case "FREQUENCY":
          return problem
            ? { claimType, statement: problem.frequency, extractedFrom: "PROBLEM.frequency", confidence: opportunityConfidence }
            : dimensionClaim(claimType, "frequency", dimensions, gapByDimension, opportunityConfidence);

        case "WILLINGNESS_TO_PAY":
          return problem
            ? { claimType, statement: problem.willingnessToPaySignal, extractedFrom: "PROBLEM.willingnessToPaySignal", confidence: opportunityConfidence }
            : dimensionClaim(claimType, "willingnessToPay", dimensions, gapByDimension, opportunityConfidence);

        case "COMPETITIVE_POSITION":
          return competitorObservations.length > 0
            ? {
                claimType,
                statement: `${competitorObservations.length} competitor observation(s) found: ${competitorObservations.map((o) => `${o.competitor.name} [${o.type}]`).join(", ")}.`,
                extractedFrom: "COMPETITOR_OBSERVATIONS",
                confidence: opportunityConfidence,
              }
            : {
                claimType,
                statement:
                  "No competitors were found in research — this may indicate no real market rather than a clear field, not yet ruled out (docs/OPPORTUNITY_INTELLIGENCE.md, Part 17).",
                extractedFrom: "COMPETITOR_OBSERVATIONS",
                confidence: ASSUMPTION_PRIOR_CONFIDENCE,
              };

        case "GROWTH_TRAJECTORY":
          // Post-launch-only signal (docs/M8_ARCHITECTURE_PROPOSAL.md §21) — genuinely unobservable at
          // opportunity-extraction time (M4, pre-launch). An honest placeholder, never a fabricated guess;
          // businessClaimExtractionService.upsertClaim (M8) updates this exact claim once real growth data exists.
          return { claimType, statement: "No growth trajectory data exists yet — this is a post-launch signal, not observable before a product is LIVE.", extractedFrom: null, confidence: NO_DATA_PRIOR_CONFIDENCE };

        case "DISTRIBUTION":
          return distributionChannels.length > 0
            ? {
                claimType,
                statement: distributionChannels.map((c) => `${c.channel} (${c.reasoning})`).join("; "),
                extractedFrom: "OPPORTUNITY.metadata.distributionChannels",
                confidence: opportunityConfidence,
              }
            : { claimType, statement: "No distribution channel has been proposed for this opportunity.", extractedFrom: null, confidence: NO_DATA_PRIOR_CONFIDENCE };

        default: {
          const dimension = DIMENSION_CLAIM_TYPES[claimType];
          if (!dimension) throw new Error(`Claim type ${claimType} has no dimension mapping and no bespoke extraction case.`);
          return dimensionClaim(claimType, dimension, dimensions, gapByDimension, opportunityConfidence);
        }
      }
    });

    const created: Claim[] = [];
    for (const input of inputs) {
      created.push(
        await claimService.create({
          opportunityId: opportunity.id,
          claimType: input.claimType,
          statement: input.statement,
          importance: CLAIM_TYPE_IMPORTANCE[input.claimType],
          confidence: input.confidence,
          extractedFrom: input.extractedFrom,
          actorType: params.actorType,
          actorId: params.actorId,
        }),
      );
    }

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: "CLAIM_EXTRACTION_COMPLETED",
      resourceType: "OPPORTUNITY",
      resourceId: opportunity.id,
      result: "SUCCESS",
      metadata: { claimCount: created.length },
    });

    return created;
  },
};

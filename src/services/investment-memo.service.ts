import type { Claim, Evidence, InvestmentMemo, ValidationReport } from "@prisma/client";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { competitorRepository, type ObservationWithCompetitor } from "../db/repositories/competitor.repository.js";
import { evidenceGapRepository } from "../db/repositories/evidence-gap.repository.js";
import { investmentMemoRepository } from "../db/repositories/investment-memo.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CompileInvestmentMemoParams {
  opportunityId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  actorType: ActorType;
  actorId: string | null;
}

/**
 * The literal fields the M4 brief names for the memo body
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §17) — stored as one JSON blob on
 * `InvestmentMemo.content`, with the mandatory strongestArgumentAgainst/
 * investmentThesis and the closing RECOMMENDATION/CONFIDENCE/KEY
 * REASON/BIGGEST RISK/NEXT ACTION block promoted to their own columns
 * (queryable without parsing JSON).
 */
export interface InvestmentMemoContent {
  opportunity: { id: string; title: string; description: string };
  problem: string | null;
  customer: string;
  whyThisMatters: string;
  evidence: Array<{ claim: string; source: string; reliability: string; confidence: number }>;
  independentEvidenceCount: number;
  wtpEvidence: string;
  marketContext: string;
  competitors: Array<{ name: string; type: string; detail: string }>;
  differentiation: string;
  distribution: string;
  buildability: string;
  attractivenessScore: number | null;
  confidenceScore: number | null;
  killRisk: number | null;
  killRiskReasons: string[];
  validatorFindings: Array<{ claimType: string; status: string; confidence: number; reasoning: string }>;
  contradictingEvidence: Array<{ claimType: string; contradictingEvidenceIds: string[] }>;
  largestAssumptions: Array<{ dimension: string; description: string }>;
  evidenceGaps: Array<{ dimension: string; description: string; suggestedResearchQuestion: string; impactScore: number }>;
  nextBestResearchQuestion: string | null;
  ceoRecommendation: { action: string; reasoning: string; confidence: number };
  chairmanRecommendation: { decision: string; reasoning: string; objections: string[]; confidence: number };
  humanDecision: "PENDING";
}

export interface InvestmentMemoResult {
  memo: InvestmentMemo;
  content: InvestmentMemoContent;
}

function claimStatementFor(claims: readonly Claim[], claimType: string): string {
  return claims.find((c) => c.claimType === claimType)?.statement ?? "(not yet extracted)";
}

/**
 * Investment Memo compilation (docs/M4_ARCHITECTURE_PROPOSAL.md §17) —
 * the milestone's literal final product: "Not an AI essay. The Human
 * Owner should be able to read one." Compiled with ZERO new model
 * calls — every field is deterministically pulled from data that
 * already exists by the time a CEO recommendation and Chairman review
 * both exist for the same opportunity.
 */
export const investmentMemoService = {
  async compile(params: CompileInvestmentMemoParams): Promise<InvestmentMemoResult> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", params.opportunityId);

    const ceoRecommendation = await ceoRecommendationRepository.findById(params.ceoRecommendationId);
    if (!ceoRecommendation || ceoRecommendation.opportunityId !== params.opportunityId) {
      throw new ValidationError(`CeoRecommendation ${params.ceoRecommendationId} does not belong to opportunity ${params.opportunityId}.`);
    }
    const chairmanReview = await chairmanReviewRepository.findById(params.chairmanReviewId);
    if (!chairmanReview || chairmanReview.opportunityId !== params.opportunityId) {
      throw new ValidationError(`ChairmanReview ${params.chairmanReviewId} does not belong to opportunity ${params.opportunityId}.`);
    }

    const evidence = await opportunityRepository.listEvidence(params.opportunityId);
    const scoreRecords = await opportunityRepository.listScoreRecords(params.opportunityId);
    const latestScore = scoreRecords[0] ?? null;
    const problem = opportunity.problemId ? await problemRepository.findById(opportunity.problemId) : null;
    const competitorObservations = problem ? await competitorRepository.listObservationsForProblem(problem.id) : [];
    const claims = await claimRepository.listForOpportunity(params.opportunityId);
    const latestReportByClaimId = new Map<string, ValidationReport>();
    for (const claim of claims) {
      const report = await validationReportRepository.findLatestForClaim(claim.id);
      if (report) latestReportByClaimId.set(claim.id, report);
    }
    const gaps = (await evidenceGapRepository.listForOpportunity(params.opportunityId)).filter((g) => g.status !== "RESOLVED");

    const metadata = fromJsonString<{ distributionChannels?: Array<{ channel: string; reasoning: string }> }>(opportunity.metadata, {});
    const distributionChannels = metadata.distributionChannels ?? [];
    const independentSourceCount = new Set(evidence.map((e) => e.sourceReference ?? e.id)).size;

    const content: InvestmentMemoContent = {
      opportunity: { id: opportunity.id, title: opportunity.title, description: opportunity.description },
      problem: problem?.statement ?? opportunity.problem,
      customer: problem?.customerSegment ?? opportunity.targetCustomer,
      whyThisMatters: problem?.pain ?? opportunity.description,
      evidence: evidence.map((e: Evidence) => ({ claim: e.claim, source: e.source, reliability: e.reliability, confidence: e.confidence })),
      independentEvidenceCount: independentSourceCount,
      wtpEvidence: claimStatementFor(claims, "WILLINGNESS_TO_PAY"),
      marketContext: claimStatementFor(claims, "MARKET_SIZE"),
      competitors: competitorObservations.map((o: ObservationWithCompetitor) => ({ name: o.competitor.name, type: o.type, detail: o.detail })),
      differentiation: claimStatementFor(claims, "DIFFERENTIATION"),
      distribution: distributionChannels.length > 0 ? distributionChannels.map((c) => `${c.channel} (${c.reasoning})`).join("; ") : claimStatementFor(claims, "DISTRIBUTION"),
      buildability: claimStatementFor(claims, "BUILDABILITY"),
      attractivenessScore: opportunity.opportunityScore,
      confidenceScore: opportunity.confidenceScore,
      killRisk: latestScore?.killRiskScore ?? null,
      killRiskReasons: latestScore?.killRiskReasons ? fromJsonString<string[]>(latestScore.killRiskReasons, []) : [],
      validatorFindings: claims.map((c) => {
        const report = latestReportByClaimId.get(c.id);
        return { claimType: c.claimType, status: c.status, confidence: c.confidence, reasoning: report?.reasoning ?? "(not yet validated)" };
      }),
      contradictingEvidence: claims
        .map((c) => {
          const report = latestReportByClaimId.get(c.id);
          const contradictingIds = report ? fromJsonString<string[]>(report.contradictingEvidenceIds, []) : [];
          return { claimType: c.claimType, contradictingEvidenceIds: contradictingIds };
        })
        .filter((entry) => entry.contradictingEvidenceIds.length > 0),
      largestAssumptions: gaps
        .filter((g) => g.status === "ASSUMPTION" || g.status === "UNKNOWN")
        .sort((a, b) => b.impactScore - a.impactScore)
        .slice(0, 5)
        .map((g) => ({ dimension: g.dimension, description: g.description })),
      evidenceGaps: gaps.map((g) => ({ dimension: g.dimension, description: g.description, suggestedResearchQuestion: g.suggestedResearchQuestion, impactScore: g.impactScore })),
      nextBestResearchQuestion: opportunity.nextBestResearchQuestion,
      ceoRecommendation: { action: ceoRecommendation.action, reasoning: ceoRecommendation.reasoning, confidence: ceoRecommendation.confidence },
      chairmanRecommendation: {
        decision: chairmanReview.decision,
        reasoning: chairmanReview.reasoning,
        objections: fromJsonString<string[]>(chairmanReview.objections, []),
        confidence: chairmanReview.confidence,
      },
      humanDecision: "PENDING",
    };

    // MANDATORY (§17): never generic, always the Chairman's own
    // top-ranked objection — chairmanDecisionSchema already requires a
    // non-empty, real objections array (M2 brief Part 16), so this is
    // never a placeholder.
    const objections = fromJsonString<string[]>(chairmanReview.objections, []);
    const strongestArgumentAgainst = objections[0] ?? chairmanReview.reasoning;
    // MANDATORY (§17): the CEO's own evidence-grounded reasoning, never a third "memo-writing" model call.
    const investmentThesis = ceoRecommendation.reasoning;

    const citedClaimTypes = fromJsonString<string[]>(ceoRecommendation.citedClaimIds, [])
      .map((id) => claims.find((c) => c.id === id)?.claimType)
      .filter((t): t is string => t !== undefined);
    const topKillRiskReason = content.killRiskReasons[0];

    const memo = await investmentMemoRepository.create({
      opportunityId: params.opportunityId,
      ceoRecommendationId: params.ceoRecommendationId,
      chairmanReviewId: params.chairmanReviewId,
      content: toJsonString(content),
      strongestArgumentAgainst,
      investmentThesis,
      recommendation: `${ceoRecommendation.action} (Chairman: ${chairmanReview.decision})`,
      confidence: ceoRecommendation.confidence,
      keyReason: citedClaimTypes.length > 0 ? `${ceoRecommendation.action}: ${citedClaimTypes.join(", ")}` : ceoRecommendation.reasoning,
      biggestRisk: topKillRiskReason ?? strongestArgumentAgainst,
      nextAction: opportunity.nextBestResearchQuestion ?? "Awaiting Human decision.",
    });

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: "INVESTMENT_MEMO_CREATED",
      resourceType: "OPPORTUNITY",
      resourceId: params.opportunityId,
      result: "SUCCESS",
      metadata: { investmentMemoId: memo.id, recommendation: memo.recommendation },
    });
    await eventBus.publish({
      type: "INVESTMENT_MEMO_CREATED",
      payload: { investmentMemoId: memo.id, opportunityId: params.opportunityId, recommendation: memo.recommendation, confidence: memo.confidence },
    });

    return { memo, content };
  },

  listForOpportunity: investmentMemoRepository.listForOpportunity,
  findLatestForOpportunity: investmentMemoRepository.findLatestForOpportunity,

  async getOrThrow(id: string): Promise<InvestmentMemo> {
    const memo = await investmentMemoRepository.findById(id);
    if (!memo) throw new NotFoundError("InvestmentMemo", id);
    return memo;
  },
};

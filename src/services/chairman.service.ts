import type { ChairmanReview, Evidence, EvidenceGap, Opportunity, OpportunityScoreRecord, Problem } from "@prisma/client";
import { z } from "zod";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { competitorRepository, type ObservationWithCompetitor } from "../db/repositories/competitor.repository.js";
import { evidenceGapRepository } from "../db/repositories/evidence-gap.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { CHAIRMAN_DECISIONS, type ChairmanDecision } from "../domain/chairman/chairman.types.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { createModelProvider } from "../providers/model-provider-factory.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

const chairmanDecisionSchema = z.object({
  decision: z.enum(CHAIRMAN_DECISIONS),
  reasoning: z.string().min(1),
  // Always non-empty: an adversarial review that surfaces zero
  // objections isn't one (M2 brief Part 16 — "not optional decoration").
  objections: z.array(z.string().min(1)).min(1),
  missingEvidence: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
});
export type ChairmanDecisionOutput = z.infer<typeof chairmanDecisionSchema>;

const CHAIRMAN_SYSTEM_PROMPT =
  "You are the Chairman of VentureForge (CONSTITUTION.md §4, §13, §15-16; M3 brief Part 27). Your job is to challenge " +
  "the CEO/research conclusions about a proposed opportunity — you must NOT automatically agree. For every review, " +
  "explicitly consider: (1) What could make this fail? (2) What assumptions are unsupported? (3) What evidence is " +
  "missing? (4) What competing explanation exists? (5) What is the strongest argument AGAINST this opportunity? " +
  "When the input includes them, also explicitly challenge: evidence QUALITY (how strong is each individual claim); " +
  "evidence INDEPENDENCE (how many genuinely separate sources corroborate this, not just how many total signals — " +
  "Part 13); willingness-to-pay ASSUMPTIONS (is there real signal someone would pay, or is this pain without a " +
  "budget); market-size and timing ASSUMPTIONS; competitive ASSUMPTIONS (does 'few competitors found' actually mean " +
  "no market, per Part 17?); distribution ASSUMPTIONS (is the proposed channel to the first customers grounded in " +
  "anything, or merely asserted?); and retention ASSUMPTIONS. If a kill-risk score and reasons are provided, treat " +
  "them as a real input to weigh, not decoration. " +
  "Record your objections even if you ultimately recommend approval — never return zero objections. " +
  'Respond with ONLY JSON matching: {"decision": "APPROVE"|"REJECT"|"REQUEST_MORE_EVIDENCE"|"DEFER"|"ESCALATE_TO_HUMAN", ' +
  '"reasoning": string, "objections": string[], "missingEvidence": string[], "confidence": number, "recommendation": string}';

export interface ReviewOpportunityParams {
  opportunityId: string;
  reviewedBy: AuthenticatedActor;
}

export interface ChairmanReviewResult {
  review: ChairmanReview;
  decision: ChairmanDecisionOutput;
}

/**
 * The Chairman (M2 brief Parts 15-16): reviews a significant
 * opportunity and genuinely challenges it — not a second CEO/agent
 * agreeing with itself. A single bounded model call (with one
 * corrective retry on invalid output), not a multi-step agent
 * execution — there is no tool use here, so the full Agent Runtime
 * (budgets, WAITING_FOR_TOOL, etc.) doesn't apply; see docs/CHAIRMAN.md.
 * The Chairman never decides the ApprovalRequest itself — it produces
 * a persisted, structured recommendation the Human Decision Queue
 * surfaces alongside the requester's own case (Constitution §17).
 */
export const chairmanService = {
  async review(params: ReviewOpportunityParams): Promise<ChairmanReviewResult> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", params.opportunityId);

    const evidence = await opportunityRepository.listEvidence(params.opportunityId);
    const scoreHistory = await opportunityRepository.listScoreRecords(params.opportunityId);
    const latestScore = scoreHistory[0] ?? null;
    const evidenceGaps = await evidenceGapRepository.listForOpportunity(params.opportunityId);
    // M3 — richer review inputs when this opportunity traces back to a
    // Problem (docs/M3_ARCHITECTURE_PROPOSAL.md §14, M3 brief Part 27):
    // the Problem itself, competitor observations, WTP/distribution
    // notes. Absent (null/[]) for M1/M2-style opportunities with no
    // problemId — the review still runs, just without this context.
    const problem = opportunity.problemId ? await problemRepository.findById(opportunity.problemId) : null;
    const competitorObservations = problem ? await competitorRepository.listObservationsForProblem(problem.id) : [];

    const provider = createModelProvider();
    const { value: decision, raw } = await completeWithValidation(
      (request) => provider.complete(request),
      chairmanDecisionSchema,
      {
        systemPrompt: CHAIRMAN_SYSTEM_PROMPT,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: buildReviewPrompt(opportunity, evidence, latestScore, problem, competitorObservations, evidenceGaps) }],
        devFixtureResponse: buildDevChairmanFixture(opportunity, evidence, latestScore, competitorObservations, evidenceGaps),
      },
    );

    const review = await chairmanReviewRepository.create({
      opportunityId: params.opportunityId,
      decision: decision.decision,
      reasoning: decision.reasoning,
      objections: toJsonString(decision.objections),
      missingEvidence: toJsonString(decision.missingEvidence),
      confidence: decision.confidence,
      recommendation: decision.recommendation,
      modelProvider: raw.provider,
      modelName: raw.model,
    });

    await auditService.record({
      actorType: params.reviewedBy.type,
      actorId: params.reviewedBy.id,
      action: `CHAIRMAN_REVIEW_${decision.decision}`,
      resourceType: "OPPORTUNITY",
      resourceId: params.opportunityId,
      result: "SUCCESS",
      metadata: { objectionCount: decision.objections.length, confidence: decision.confidence },
    });
    await eventBus.publish({
      type: "OPPORTUNITY_UPDATED",
      payload: { opportunityId: params.opportunityId, chairmanDecision: decision.decision },
    });

    return { review, decision };
  },

  getLatestReview: chairmanReviewRepository.findLatestForOpportunity,
  listReviews: chairmanReviewRepository.listForOpportunity,
};

function buildReviewPrompt(
  opportunity: Opportunity,
  evidence: Evidence[],
  latestScore: OpportunityScoreRecord | null,
  problem: Problem | null,
  competitorObservations: ObservationWithCompetitor[],
  evidenceGaps: EvidenceGap[],
): string {
  const evidenceLines = evidence.map(
    (item, index) =>
      `${index + 1}. [${item.sourceType}, reliability=${item.reliability}, confidence=${item.confidence}] ${item.claim} ` +
      `(source: ${item.source}${item.sourceReference ? `, ${item.sourceReference}` : ""})`,
  );
  const independentSourceCount = new Set(evidence.map((item) => item.sourceReference ?? item.id)).size;
  const competitorLines = competitorObservations.map((obs) => `- ${obs.competitor.name} [${obs.type}]: ${obs.detail}`);
  const metadata = fromJsonString<{ distributionChannels?: Array<{ channel: string; reasoning: string }> }>(opportunity.metadata, {});
  const distributionChannels = metadata.distributionChannels ?? [];
  const assumedGaps = evidenceGaps.filter((gap) => gap.status !== "RESOLVED");

  return [
    `Opportunity: ${opportunity.title}`,
    `Problem: ${opportunity.problem}`,
    `Target customer: ${opportunity.targetCustomer}`,
    `Description: ${opportunity.description}`,
    `Opportunity score: ${opportunity.opportunityScore ?? "not yet scored"}`,
    `Confidence score: ${opportunity.confidenceScore ?? "not yet scored"}`,
    `Kill-risk score: ${latestScore?.killRiskScore ?? "not yet assessed"}`,
    `Kill-risk reasons: ${latestScore?.killRiskReasons ? fromJsonString<string[]>(latestScore.killRiskReasons, []).join("; ") || "(none flagged)" : "(none assessed)"}`,
    `Validation level: ${opportunity.validationLevel}`,
    `Latest score dimensions: ${latestScore ? latestScore.dimensions : "none"}`,
    "",
    `Evidence (${evidence.length} record(s), ~${independentSourceCount} distinct source reference(s) — never equate raw count with independent corroboration):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none)"]),
    "",
    problem
      ? [
          `Problem detail — customer segment: ${problem.customerSegment}; frequency: ${problem.frequency}; current solution: ${problem.currentSolution}; dissatisfaction: ${problem.dissatisfaction}; WTP signal: ${problem.willingnessToPaySignal}`,
        ].join("")
      : "Problem detail: (this opportunity has no linked Problem record — pre-M3 or manually-entered)",
    "",
    `Competitor observations (${competitorObservations.length}):`,
    ...(competitorLines.length > 0 ? competitorLines : ["(none found — per Part 17, this may mean no market, not a green light)"]),
    "",
    `Distribution channels claimed (${distributionChannels.length}):`,
    ...(distributionChannels.length > 0 ? distributionChannels.map((c) => `- ${c.channel}: ${c.reasoning}`) : ["(none proposed)"]),
    "",
    `Known evidence gaps / assumptions already flagged (${assumedGaps.length}):`,
    ...(assumedGaps.length > 0 ? assumedGaps.map((gap) => `- [${gap.dimension}] ${gap.description}`) : ["(none recorded)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — a deterministic, rule-based stand-in for real
 * adversarial reasoning, derived from the opportunity's *actual*
 * evidence and score so different opportunities genuinely get
 * different objections and decisions (never a static "always approve"
 * stub). Clearly labeled; never presented as real Chairman reasoning.
 * See docs/CHAIRMAN.md.
 */
function buildDevChairmanFixture(
  opportunity: Opportunity,
  evidence: Evidence[],
  latestScore: OpportunityScoreRecord | null,
  competitorObservations: ObservationWithCompetitor[],
  evidenceGaps: EvidenceGap[],
): ChairmanDecisionOutput {
  const evidenceCount = evidence.length;
  const averageConfidence = evidenceCount > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidenceCount : 0;
  const confidenceScore = opportunity.confidenceScore ?? 0;
  const opportunityScore = opportunity.opportunityScore ?? 0;
  const hasDirectCustomerEvidence = evidence.some((item) => item.sourceType === "CUSTOMER");
  // M3 — independence is a distinct axis from raw count (Part 13):
  // count distinct source references, never just evidence rows.
  const independentSourceCount = new Set(evidence.map((item) => item.sourceReference ?? item.id)).size;
  const killRiskScore = latestScore?.killRiskScore ?? null;
  const unresolvedGaps = evidenceGaps.filter((gap) => gap.status !== "RESOLVED");

  const objections: string[] = [];
  const missingEvidence: string[] = [];

  if (evidenceCount < 2) {
    objections.push("[DEV FIXTURE] Fewer than two evidence records back this opportunity — a single source could be an outlier.");
    missingEvidence.push("A second, independent evidence source corroborating the claimed pain point.");
  }
  if (independentSourceCount < evidenceCount) {
    objections.push(
      `[DEV FIXTURE] Only ${independentSourceCount} genuinely independent source(s) back ${evidenceCount} evidence record(s) — some evidence shares a source reference (Part 13: raw count is not independence).`,
    );
  }
  if (averageConfidence < 0.6) {
    objections.push(`[DEV FIXTURE] Average evidence confidence is only ${averageConfidence.toFixed(2)} — the underlying claims are weakly supported.`);
  }
  if (confidenceScore < 0.5) {
    objections.push(`[DEV FIXTURE] The opportunity's own confidence score (${confidenceScore.toFixed(2)}) is below 0.5.`);
  }
  if (!hasDirectCustomerEvidence) {
    objections.push("[DEV FIXTURE] No direct customer evidence — every signal is secondary (web/market), not a real customer's own words.");
    missingEvidence.push("At least one direct customer interview or quote.");
  }
  if (competitorObservations.length === 0) {
    objections.push("[DEV FIXTURE] No competitors were found — per Part 17 this may mean no real market rather than a clear field; not yet ruled out.");
  }
  if (killRiskScore !== null && killRiskScore >= 0.5) {
    objections.push(`[DEV FIXTURE] Kill-risk score is ${killRiskScore.toFixed(2)} — meaningful risk factors were identified and should not be waved away.`);
  }
  if (unresolvedGaps.length > 0) {
    objections.push(`[DEV FIXTURE] ${unresolvedGaps.length} dimension(s) were scored on assumption, not direct evidence — see evidence gaps.`);
  }
  objections.push("[DEV FIXTURE] No competing-explanation analysis has been performed — an alternative cause for the observed discussion has not been ruled out.");

  const highKillRisk = killRiskScore !== null && killRiskScore >= 0.6;
  const decision: ChairmanDecision =
    evidenceCount < 2 || averageConfidence < 0.4
      ? "REQUEST_MORE_EVIDENCE"
      : highKillRisk
        ? "REJECT"
        : opportunityScore >= 0.6 && confidenceScore >= 0.5
          ? "APPROVE"
          : "REQUEST_MORE_EVIDENCE";

  return {
    decision,
    reasoning:
      `[DEV FIXTURE] Deterministic rule-based review (no real model call): opportunityScore=${opportunityScore.toFixed(2)}, ` +
      `confidenceScore=${confidenceScore.toFixed(2)}, killRiskScore=${killRiskScore?.toFixed(2) ?? "n/a"}, evidenceCount=${evidenceCount}, ` +
      `independentSourceCount=${independentSourceCount}, averageEvidenceConfidence=${averageConfidence.toFixed(2)}, competitorCount=${competitorObservations.length}.`,
    objections,
    missingEvidence,
    confidence: Math.min(0.6, confidenceScore + 0.1),
    recommendation:
      decision === "APPROVE"
        ? "[DEV FIXTURE] Evidence and score clear the deterministic bar for approval, but see objections above before proceeding."
        : decision === "REJECT"
          ? "[DEV FIXTURE] Kill-risk is too high to recommend proceeding without addressing the flagged risk factors first."
          : "[DEV FIXTURE] Gather stronger, more direct, more independent evidence before advancing this opportunity further.",
  };
}

import type { ChairmanReview, Evidence, Opportunity, OpportunityScoreRecord } from "@prisma/client";
import { z } from "zod";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { CHAIRMAN_DECISIONS, type ChairmanDecision } from "../domain/chairman/chairman.types.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
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
  "You are the Chairman of VentureForge (CONSTITUTION.md §4, §13, §15-16). Your job is to challenge the CEO/research " +
  "conclusions about a proposed opportunity — you must NOT automatically agree. For every review, explicitly consider: " +
  "(1) What could make this fail? (2) What assumptions are unsupported? (3) What evidence is missing? " +
  "(4) What competing explanation exists? (5) What is the strongest argument AGAINST this opportunity? " +
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

    const provider = createModelProvider();
    const { value: decision, raw } = await completeWithValidation(
      (request) => provider.complete(request),
      chairmanDecisionSchema,
      {
        systemPrompt: CHAIRMAN_SYSTEM_PROMPT,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: buildReviewPrompt(opportunity, evidence, latestScore) }],
        devFixtureResponse: buildDevChairmanFixture(opportunity, evidence, latestScore),
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

function buildReviewPrompt(opportunity: Opportunity, evidence: Evidence[], latestScore: OpportunityScoreRecord | null): string {
  const evidenceLines = evidence.map(
    (item, index) =>
      `${index + 1}. [${item.sourceType}, reliability=${item.reliability}, confidence=${item.confidence}] ${item.claim} ` +
      `(source: ${item.source}${item.sourceReference ? `, ${item.sourceReference}` : ""})`,
  );

  return [
    `Opportunity: ${opportunity.title}`,
    `Problem: ${opportunity.problem}`,
    `Target customer: ${opportunity.targetCustomer}`,
    `Description: ${opportunity.description}`,
    `Opportunity score: ${opportunity.opportunityScore ?? "not yet scored"}`,
    `Confidence score: ${opportunity.confidenceScore ?? "not yet scored"}`,
    `Validation level: ${opportunity.validationLevel}`,
    `Latest score dimensions: ${latestScore ? latestScore.dimensions : "none"}`,
    "",
    `Evidence (${evidence.length} record(s)):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none)"]),
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
  _latestScore: OpportunityScoreRecord | null,
): ChairmanDecisionOutput {
  const evidenceCount = evidence.length;
  const averageConfidence = evidenceCount > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidenceCount : 0;
  const confidenceScore = opportunity.confidenceScore ?? 0;
  const opportunityScore = opportunity.opportunityScore ?? 0;
  const hasDirectCustomerEvidence = evidence.some((item) => item.sourceType === "CUSTOMER");

  const objections: string[] = [];
  const missingEvidence: string[] = [];

  if (evidenceCount < 2) {
    objections.push("[DEV FIXTURE] Fewer than two evidence records back this opportunity — a single source could be an outlier.");
    missingEvidence.push("A second, independent evidence source corroborating the claimed pain point.");
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
  objections.push("[DEV FIXTURE] No competing-explanation analysis has been performed — an alternative cause for the observed discussion has not been ruled out.");

  const decision: ChairmanDecision = evidenceCount < 2 || averageConfidence < 0.4 ? "REQUEST_MORE_EVIDENCE" : opportunityScore >= 0.6 && confidenceScore >= 0.5 ? "APPROVE" : "REQUEST_MORE_EVIDENCE";

  return {
    decision,
    reasoning:
      `[DEV FIXTURE] Deterministic rule-based review (no real model call): opportunityScore=${opportunityScore.toFixed(2)}, ` +
      `confidenceScore=${confidenceScore.toFixed(2)}, evidenceCount=${evidenceCount}, averageEvidenceConfidence=${averageConfidence.toFixed(2)}.`,
    objections,
    missingEvidence,
    confidence: Math.min(0.6, confidenceScore + 0.1),
    recommendation:
      decision === "APPROVE"
        ? "[DEV FIXTURE] Evidence and score clear the deterministic bar for approval, but see objections above before proceeding."
        : "[DEV FIXTURE] Gather stronger, more direct evidence before advancing this opportunity further.",
  };
}

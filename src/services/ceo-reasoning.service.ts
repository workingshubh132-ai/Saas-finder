import type { Claim, CeoRecommendation, ValidationReport } from "@prisma/client";
import { z } from "zod";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { CEO_DECISION_ACTIONS } from "../domain/decision/decision-action.types.js";
import { computeDecisionPriority, PLACEHOLDER_NEUTRAL_SCORE } from "../domain/decision/priority.js";
import { ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/**
 * Zero tool calls, by construction (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §12) — one bounded reasoning call over already-persisted data, same
 * `maxToolCalls: 0` shape opportunity-analyst.service.ts already uses
 * for its own synthesis-only step. The CEO's registered Agent should
 * additionally hold zero AgentPermission grants (§23) — a second,
 * independent enforcement layer beyond this budget.
 */
export const CEO_REASONING_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const ceoDecisionSchema = z.object({
  action: z.enum(CEO_DECISION_ACTIONS),
  reasoning: z.string().min(1),
  // Every recommendation must cite specific claim ids — never "KILL — score 42" with no reasoning (§12).
  citedClaimIds: z.array(z.string().min(1)).min(1),
  citedValidationReportIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
});
type CeoDecision = z.infer<typeof ceoDecisionSchema>;

const CEO_SYSTEM_PROMPT =
  "You are the CEO of VentureForge (docs/M4_ARCHITECTURE_PROPOSAL.md §12-14; CONSTITUTION.md). VentureForge must " +
  "become better at saying NO. Decide what should happen next for ONE opportunity, based ONLY on the claims, " +
  "validation reports, scores, and evidence gaps given below — you have no tools and cannot search for anything " +
  "yourself; treat every input as already-established fact, not something to re-derive. Choose exactly one action: " +
  "KILL (a CRITICAL or HIGH-importance claim is CONTRADICTED, or the evidence overall does not support proceeding — " +
  "recommend killing with a specific reason, never just because a score is low); DEPRIORITIZE (worth keeping on " +
  "record but not worth researching further right now); INVESTIGATE (a specific claim's uncertainty is worth " +
  "resolving next); VALIDATE_CUSTOMER (recommend the Human Owner personally talk to a real customer next — you " +
  "never contact anyone yourself, this is a recommendation only); PREPARE_REVIEW (evidence is strong enough that a " +
  "human should make a real go/no-go decision now); or HUMAN_REVIEW (you cannot confidently resolve this yourself " +
  "— an honest, valid outcome, not a failure). A LOW SCORE IS NOT THE SAME THING AS A KILL: distinguish them. A " +
  "HIGH score with HIGH kill risk may deserve INVESTIGATE rather than either extreme. Every recommendation MUST " +
  "cite the specific claim ids (and validation report ids where they exist) that justify it. " +
  'Respond with ONLY JSON matching: {"action": "KILL"|"DEPRIORITIZE"|"INVESTIGATE"|"VALIDATE_CUSTOMER"|' +
  '"PREPARE_REVIEW"|"HUMAN_REVIEW", "reasoning": string, "citedClaimIds": string[], "citedValidationReportIds": ' +
  'string[], "confidence": number}';

export interface RunCeoReasoningParams {
  agentId: string;
  opportunityId: string;
  decisionCycleId?: string | null;
  startedBy: AuthenticatedActor;
}

export interface CeoReasoningResult {
  recommendation: CeoRecommendation;
}

function buildDecisionPrompt(
  opportunity: { title: string; opportunityScore: number | null; confidenceScore: number | null },
  killRiskScore: number | null,
  killRiskReasons: string[],
  claims: readonly Claim[],
  latestReportByClaimId: ReadonlyMap<string, ValidationReport>,
  gapDescriptions: readonly string[],
): string {
  const claimLines = claims.map((c) => {
    const report = latestReportByClaimId.get(c.id);
    return (
      `- [id=${c.id}] [${c.claimType}] importance=${c.importance} status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}` +
      (report ? ` | latest validation [reportId=${report.id}]: ${report.reasoning}` : " | not yet validated")
    );
  });

  return [
    `Opportunity: ${opportunity.title}`,
    `Opportunity score: ${opportunity.opportunityScore ?? "not yet scored"}`,
    `Confidence score: ${opportunity.confidenceScore ?? "not yet scored"}`,
    `Kill-risk score: ${killRiskScore ?? "not yet assessed"}`,
    `Kill-risk reasons: ${killRiskReasons.length > 0 ? killRiskReasons.join("; ") : "(none flagged)"}`,
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none extracted yet)"]),
    "",
    `Unresolved evidence gaps (${gapDescriptions.length}):`,
    ...(gapDescriptions.length > 0 ? gapDescriptions : ["(none — fully evidenced)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the
 * opportunity's *actual* claims and scores, same discipline as
 * buildDevChairmanFixture/buildDevOpportunityFixture. Never a static
 * "always investigate" stub.
 */
function buildDevCeoFixture(
  opportunity: { opportunityScore: number | null; confidenceScore: number | null },
  killRiskScore: number | null,
  claims: readonly Claim[],
  latestReportByClaimId: ReadonlyMap<string, ValidationReport>,
  topGap: { claimId: string | null; description: string } | null,
): CeoDecision {
  const sortedByConfidence = [...claims].sort((a, b) => a.confidence - b.confidence);
  const fallbackClaimId = sortedByConfidence[0]?.id;
  if (!fallbackClaimId) {
    throw new ValidationError("Cannot produce a CEO recommendation for an opportunity with no claims — run claim extraction first.");
  }

  const reportsFor = (ids: string[]): string[] => ids.map((id) => latestReportByClaimId.get(id)?.id).filter((id): id is string => id !== undefined);

  const contradictedImportant = claims.filter((c) => (c.importance === "CRITICAL" || c.importance === "HIGH") && c.status === "CONTRADICTED");
  if (contradictedImportant.length > 0) {
    const citedClaimIds = contradictedImportant.map((c) => c.id);
    return {
      action: "KILL",
      reasoning: `[DEV FIXTURE] ${contradictedImportant.length} CRITICAL/HIGH-importance claim(s) are CONTRADICTED: ${contradictedImportant.map((c) => c.claimType).join(", ")}.`,
      citedClaimIds,
      citedValidationReportIds: reportsFor(citedClaimIds),
      confidence: 0.7,
    };
  }

  const score = opportunity.opportunityScore ?? 0;
  const confidence = opportunity.confidenceScore ?? 0;
  const highKillRisk = killRiskScore !== null && killRiskScore >= 0.6;

  if (score >= 0.5 && confidence >= 0.5 && !highKillRisk) {
    const supported = claims.filter((c) => (c.importance === "CRITICAL" || c.importance === "HIGH") && c.status === "SUPPORTED");
    const citedClaimIds = supported.length > 0 ? supported.map((c) => c.id) : [fallbackClaimId];
    return {
      action: "PREPARE_REVIEW",
      reasoning: `[DEV FIXTURE] opportunityScore=${score.toFixed(2)}, confidenceScore=${confidence.toFixed(2)}, killRisk=${(killRiskScore ?? 0).toFixed(2)} clear the deterministic bar for a real human go/no-go decision.`,
      citedClaimIds,
      citedValidationReportIds: reportsFor(citedClaimIds),
      confidence: Math.min(0.75, confidence),
    };
  }

  if (topGap) {
    const citedClaimIds = [topGap.claimId ?? fallbackClaimId];
    return {
      action: "INVESTIGATE",
      reasoning: `[DEV FIXTURE] Largest unresolved gap: ${topGap.description}`,
      citedClaimIds,
      citedValidationReportIds: reportsFor(citedClaimIds),
      confidence: 0.4,
    };
  }

  if (highKillRisk) {
    return {
      action: "DEPRIORITIZE",
      reasoning: `[DEV FIXTURE] Kill risk ${(killRiskScore ?? 0).toFixed(2)} is elevated but no single claim justifies an explicit kill yet.`,
      citedClaimIds: [fallbackClaimId],
      citedValidationReportIds: reportsFor([fallbackClaimId]),
      confidence: 0.3,
    };
  }

  return {
    action: "HUMAN_REVIEW",
    reasoning: "[DEV FIXTURE] No deterministic rule confidently resolves this opportunity yet — an honest escalation, not a failure.",
    citedClaimIds: [fallbackClaimId],
    citedValidationReportIds: reportsFor([fallbackClaimId]),
    confidence: 0.3,
  };
}

/**
 * The CEO (docs/M4_ARCHITECTURE_PROPOSAL.md §12-14) — bounded
 * reasoning over already-validated claims, never a re-derivation of
 * evidence. Its recommendation is never auto-applied: KILL/PREPARE_REVIEW/
 * HUMAN_REVIEW create an ApprovalRequest through the unchanged
 * approvalService (decision-cycle.service.ts, §16); DEPRIORITIZE/
 * INVESTIGATE only touch the research queue's priority, the same
 * autonomy class M3's queue already runs at.
 */
export const ceoReasoningService = {
  async run(params: RunCeoReasoningParams): Promise<RunOutcome<CeoReasoningResult>> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new ValidationError(`Opportunity ${params.opportunityId} not found`);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { opportunityId: params.opportunityId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const claims = await claimRepository.listForOpportunity(params.opportunityId);
        const latestReportByClaimId = new Map<string, ValidationReport>();
        for (const claim of claims) {
          const report = await validationReportRepository.findLatestForClaim(claim.id);
          if (report) latestReportByClaimId.set(claim.id, report);
        }

        const scoreRecords = await opportunityRepository.listScoreRecords(params.opportunityId);
        const latestScore = scoreRecords[0] ?? null;
        const killRiskScore = latestScore?.killRiskScore ?? null;
        const killRiskReasons = latestScore?.killRiskReasons ? (JSON.parse(latestScore.killRiskReasons) as string[]) : [];

        const gaps = await evidenceGapService.listForOpportunity(params.opportunityId);
        const unresolvedGaps = gaps.filter((g) => g.status !== "RESOLVED");
        const [topGap] = [...unresolvedGaps].sort((a, b) => b.impactScore - a.impactScore);
        const topGapImpactScore = topGap?.impactScore ?? 0;

        const { value: decision } = await completeWithValidation(handle.callModel, ceoDecisionSchema, {
          systemPrompt: CEO_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: buildDecisionPrompt(
                opportunity,
                killRiskScore,
                killRiskReasons,
                claims,
                latestReportByClaimId,
                unresolvedGaps.map((g) => `- [${g.dimension}] ${g.description} (impact=${g.impactScore.toFixed(2)})`),
              ),
            },
          ],
          devFixtureResponse: buildDevCeoFixture(opportunity, killRiskScore, claims, latestReportByClaimId, topGap ? { claimId: topGap.claimId, description: topGap.description } : null),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Deterministic cross-opportunity prioritization (§14) — never asked of the model.
        const priorityScore = computeDecisionPriority({
          opportunityScore: opportunity.opportunityScore ?? 0,
          confidenceScore: opportunity.confidenceScore ?? 0,
          killRiskScore: killRiskScore ?? 0,
          topEvidenceGapImpactScore: topGapImpactScore,
          maxClaimEIG: topGapImpactScore,
          estimatedResearchCost: PLACEHOLDER_NEUTRAL_SCORE,
          timeSensitivityScore: PLACEHOLDER_NEUTRAL_SCORE,
          strategicFitScore: PLACEHOLDER_NEUTRAL_SCORE,
        });

        const recommendation = await ceoRecommendationRepository.create({
          opportunityId: params.opportunityId,
          decisionCycleId: params.decisionCycleId ?? null,
          action: decision.action,
          reasoning: decision.reasoning,
          citedClaimIds: toJsonString(decision.citedClaimIds),
          citedValidationReportIds: toJsonString(decision.citedValidationReportIds),
          confidence: decision.confidence,
          priorityScore,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: `CEO_RECOMMENDATION_${decision.action}`,
          resourceType: "OPPORTUNITY",
          resourceId: params.opportunityId,
          result: "SUCCESS",
          metadata: { recommendationId: recommendation.id, confidence: decision.confidence, priorityScore },
        });
        await eventBus.publish({
          type: "CEO_RECOMMENDATION_ISSUED",
          payload: { recommendationId: recommendation.id, opportunityId: params.opportunityId, action: decision.action, confidence: decision.confidence },
        });

        return { recommendation };
      },
      CEO_REASONING_BUDGET,
    );
  },
};

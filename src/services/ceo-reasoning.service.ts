import type { Claim, CeoRecommendation, EngineeringTask, ProductSpec, ValidationReport } from "@prisma/client";
import { z } from "zod";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { codeReviewRepository } from "../db/repositories/code-review.repository.js";
import { customerResponseRepository } from "../db/repositories/customer-response.repository.js";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import { outreachExperimentRepository } from "../db/repositories/outreach-experiment.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { qaReportRepository } from "../db/repositories/qa-report.repository.js";
import { securityReviewRepository } from "../db/repositories/security-review.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { CEO_DECISION_ACTIONS } from "../domain/decision/decision-action.types.js";
import { CUSTOMER_DISCOVERY_ACTIONS } from "../domain/decision/customer-discovery-action.types.js";
import { PRODUCT_BUILD_ACTIONS } from "../domain/decision/product-build-action.types.js";
import { computeDecisionPriority, PLACEHOLDER_NEUTRAL_SCORE } from "../domain/decision/priority.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
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

const customerDiscoveryDecisionSchema = z.object({
  action: z.enum(CUSTOMER_DISCOVERY_ACTIONS),
  reasoning: z.string().min(1),
  citedClaimIds: z.array(z.string().min(1)).min(1),
  /** Only meaningful for TEST_CLAIM — which specific claim customer discovery should test next. Null for every other action. */
  targetClaimId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
type CustomerDiscoveryDecision = z.infer<typeof customerDiscoveryDecisionSchema>;

interface CustomerDiscoveryExperimentSummary {
  experimentId: string;
  claimId: string;
  responseCount: number;
  analyzedCount: number;
  negativeCount: number;
  independentOrganizations: number;
}

const CEO_CUSTOMER_DISCOVERY_SYSTEM_PROMPT =
  "You are the CEO of VentureForge, now deciding a customer-discovery step (docs/M5_ARCHITECTURE_PROPOSAL.md §20, " +
  "§26-27; CONSTITUTION.md). This is a DIFFERENT question from your usual KILL/DEPRIORITIZE/etc. decision: given the " +
  "opportunity's claims, their validation status, unresolved evidence gaps, and (if one exists) the current outreach " +
  "experiment's own responses so far, decide what customer-discovery step is worth taking next. You have no tools " +
  "and cannot search or contact anyone yourself. Choose exactly one action: RUN_CUSTOMER_DISCOVERY (no discovery has " +
  "started yet and a real claim is worth testing with real prospects); TEST_CLAIM (a SPECIFIC claim — name it in " +
  "targetClaimId — is the highest-value thing to learn next, whether starting fresh or refining an active " +
  "experiment); REFINE_ICP (the current targeting looks wrong — too broad, too narrow, or evidence suggests the " +
  "wrong audience); STOP_EXPERIMENT (the active experiment has enough independent negative signal, or has run its " +
  "course, and continuing would not change the answer); REQUEST_HUMAN_REVIEW (you cannot confidently resolve this " +
  "yourself — an honest, valid outcome). Optimize for expected decision impact per unit of effort: prefer testing " +
  "whichever claim has the largest unresolved evidence gap. Every recommendation MUST cite the specific claim ids " +
  "that justify it. You NEVER send messages or contact anyone — you only recommend. " +
  'Respond with ONLY JSON matching: {"action": "RUN_CUSTOMER_DISCOVERY"|"REFINE_ICP"|"TEST_CLAIM"|"STOP_EXPERIMENT"|' +
  '"REQUEST_HUMAN_REVIEW", "reasoning": string, "citedClaimIds": string[], "targetClaimId": string|null, ' +
  '"confidence": number}';

const productBuildDecisionSchema = z.object({
  action: z.enum(PRODUCT_BUILD_ACTIONS),
  reasoning: z.string().min(1),
  citedClaimIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
});
type ProductBuildDecision = z.infer<typeof productBuildDecisionSchema>;

interface EngineeringTaskOutcomeSummary {
  taskCount: number;
  completedCount: number;
  blockingCodeReviewCount: number;
  qaFailCount: number;
  securityFailCount: number;
}

const CEO_PRODUCT_BUILD_SYSTEM_PROMPT =
  "You are the CEO of VentureForge, now deciding a product-build step (docs/M6_ARCHITECTURE_PROPOSAL.md §32). This " +
  "is a THIRD, distinct question from your usual opportunity-kill or customer-discovery decisions: given a product " +
  "specification, its technical architecture, and the real outcome of the engineering pipeline (tasks completed, " +
  "code review, QA, and security verdicts), decide what should happen to this product build next. You have no " +
  "tools and cannot search, build, or contact anyone yourself — every input is already-established fact, not " +
  "something to re-derive. Choose exactly one action: BUILD (the technical pipeline is genuinely clean — every " +
  "task completed, no blocking review findings, security passed — recommend a real human go/no-go decision now); " +
  "CONTINUE_BUILD (progress is real but incomplete — more of the already-approved MVP boundary is worth building " +
  "next); CUT_SCOPE (the attempt reveals the MVP is trying to do too much — recommend narrowing the boundary " +
  "further before continuing); REQUEST_CUSTOMER_RESEARCH (the thesis this product is grounded in is too thin — " +
  "recommend more customer evidence before investing further engineering effort); STOP (a fundamental problem — a " +
  "security failure, a thesis that does not hold up — makes continuing this build attempt unwise); or " +
  "REQUEST_HUMAN_REVIEW (you cannot confidently resolve this yourself — an honest, valid outcome). Every " +
  "recommendation MUST cite the specific claim ids the ProductSpec itself is grounded in. " +
  'Respond with ONLY JSON matching: {"action": "BUILD"|"CONTINUE_BUILD"|"CUT_SCOPE"|"REQUEST_CUSTOMER_RESEARCH"|' +
  '"STOP"|"REQUEST_HUMAN_REVIEW", "reasoning": string, "citedClaimIds": string[], "confidence": number}';

function buildProductBuildPrompt(spec: ProductSpec, groundedInClaimIds: readonly string[], outcome: EngineeringTaskOutcomeSummary): string {
  return [
    `Product spec: ${spec.name}`,
    `Target customer: ${spec.targetCustomer}`,
    `Core problem: ${spec.coreProblem}`,
    `Core workflow: ${spec.coreWorkflow}`,
    `Grounded in ${groundedInClaimIds.length} real claim(s): ${groundedInClaimIds.join(", ") || "(none)"}`,
    "",
    `Engineering pipeline outcome: ${outcome.completedCount}/${outcome.taskCount} task(s) completed.`,
    `Code review: ${outcome.blockingCodeReviewCount} task(s) with a BLOCKER finding.`,
    `QA: ${outcome.qaFailCount} task(s) with a FAIL verdict.`,
    `Security: ${outcome.securityFailCount} task(s) with a FAIL verdict.`,
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the real
 * ProductSpec's own grounded claims and the real engineering pipeline
 * outcome, same discipline as buildDevCeoFixture/buildDevCustomerDiscoveryFixture.
 */
function buildDevProductBuildFixture(groundedInClaimIds: readonly string[], outcome: EngineeringTaskOutcomeSummary): ProductBuildDecision {
  if (groundedInClaimIds.length === 0) {
    throw new ValidationError("Cannot produce a product-build recommendation for a ProductSpec grounded in no claims.");
  }
  const citedClaimIds = [...groundedInClaimIds];

  if (outcome.securityFailCount > 0) {
    return {
      action: "STOP",
      reasoning: `[DEV FIXTURE] ${outcome.securityFailCount} engineering task(s) failed Security Review — continuing this build attempt without resolving a real security failure is not recommended.`,
      citedClaimIds,
      confidence: 0.8,
    };
  }
  if (outcome.completedCount < outcome.taskCount) {
    return {
      action: "CUT_SCOPE",
      reasoning: `[DEV FIXTURE] Only ${outcome.completedCount}/${outcome.taskCount} engineering task(s) completed within their bounded retry budget — the current MVP boundary may still be too large to build reliably.`,
      citedClaimIds,
      confidence: 0.6,
    };
  }
  if (outcome.blockingCodeReviewCount > 0 || outcome.qaFailCount > 0) {
    return {
      action: "REQUEST_HUMAN_REVIEW",
      reasoning: `[DEV FIXTURE] All tasks completed, but ${outcome.blockingCodeReviewCount} carry a blocking code-review finding and ${outcome.qaFailCount} failed QA — a human should weigh these before a go/no-go decision.`,
      citedClaimIds,
      confidence: 0.5,
    };
  }

  return {
    action: "BUILD",
    reasoning: `[DEV FIXTURE] All ${outcome.taskCount} engineering task(s) completed cleanly — no blocking code-review findings, no QA or security failures. Ready for a real human go/no-go decision.`,
    citedClaimIds,
    confidence: 0.75,
  };
}

function buildCustomerDiscoveryPrompt(
  opportunity: { title: string; opportunityScore: number | null; confidenceScore: number | null },
  claims: readonly Claim[],
  latestReportByClaimId: ReadonlyMap<string, ValidationReport>,
  topGap: { claimId: string | null; description: string; impactScore: number } | null,
  experiment: CustomerDiscoveryExperimentSummary | null,
): string {
  const claimLines = claims.map((c) => {
    const report = latestReportByClaimId.get(c.id);
    return (
      `- [id=${c.id}] [${c.claimType}] importance=${c.importance} status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}` +
      (report ? ` | latest validation: ${report.reasoning}` : " | not yet validated")
    );
  });

  return [
    `Opportunity: ${opportunity.title}`,
    `Opportunity score: ${opportunity.opportunityScore ?? "not yet scored"}`,
    `Confidence score: ${opportunity.confidenceScore ?? "not yet scored"}`,
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none extracted yet)"]),
    "",
    topGap
      ? `Highest-impact unresolved gap: [claimId=${topGap.claimId ?? "none"}] ${topGap.description} (impact=${topGap.impactScore.toFixed(2)})`
      : "No unresolved evidence gaps.",
    "",
    experiment
      ? `Active outreach experiment [id=${experiment.experimentId}] testing claim [id=${experiment.claimId}]: ${experiment.responseCount} response(s) received, ${experiment.analyzedCount} analyzed, ${experiment.negativeCount} negative, ${experiment.independentOrganizations} independent organization(s) represented.`
      : "No active outreach experiment for this opportunity yet.",
  ].join("\n");
}

const STOP_EXPERIMENT_MIN_INDEPENDENT_NEGATIVE = 3;

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the
 * opportunity's actual claims/gaps/experiment state, same discipline
 * as buildDevCeoFixture. Never a static "always X" stub.
 */
function buildDevCustomerDiscoveryFixture(
  claims: readonly Claim[],
  topGap: { claimId: string | null; description: string } | null,
  experiment: CustomerDiscoveryExperimentSummary | null,
): CustomerDiscoveryDecision {
  const sortedByConfidence = [...claims].sort((a, b) => a.confidence - b.confidence);
  const fallbackClaimId = sortedByConfidence[0]?.id;
  if (!fallbackClaimId) {
    throw new ValidationError("Cannot produce a customer-discovery recommendation for an opportunity with no claims — run claim extraction first.");
  }

  if (experiment && experiment.negativeCount >= STOP_EXPERIMENT_MIN_INDEPENDENT_NEGATIVE && experiment.independentOrganizations >= STOP_EXPERIMENT_MIN_INDEPENDENT_NEGATIVE) {
    return {
      action: "STOP_EXPERIMENT",
      reasoning: `[DEV FIXTURE] Active experiment has ${experiment.negativeCount} negative response(s) across ${experiment.independentOrganizations} independent organization(s) — continuing is unlikely to change the answer.`,
      citedClaimIds: [experiment.claimId],
      targetClaimId: null,
      confidence: 0.7,
    };
  }

  const segmentClaim = claims.find((c) => c.claimType === "CUSTOMER_SEGMENT");
  if (segmentClaim && (segmentClaim.status === "CONTRADICTED" || segmentClaim.status === "WEAK")) {
    return {
      action: "REFINE_ICP",
      reasoning: `[DEV FIXTURE] CUSTOMER_SEGMENT claim is ${segmentClaim.status} — the current targeting likely needs refinement before more outreach.`,
      citedClaimIds: [segmentClaim.id],
      targetClaimId: null,
      confidence: 0.5,
    };
  }

  if (topGap?.claimId && (!experiment || experiment.claimId !== topGap.claimId)) {
    return {
      action: experiment ? "TEST_CLAIM" : "RUN_CUSTOMER_DISCOVERY",
      reasoning: `[DEV FIXTURE] Highest-impact unresolved gap targets claim ${topGap.claimId} — worth testing with real prospects next.`,
      citedClaimIds: [topGap.claimId],
      targetClaimId: topGap.claimId,
      confidence: 0.6,
    };
  }

  return {
    action: "REQUEST_HUMAN_REVIEW",
    reasoning: "[DEV FIXTURE] No deterministic rule confidently resolves the next customer-discovery step — an honest escalation, not a failure.",
    citedClaimIds: [fallbackClaimId],
    targetClaimId: null,
    confidence: 0.3,
  };
}

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

  /**
   * The second, distinct entry point (docs/M5_ARCHITECTURE_PROPOSAL.md
   * §20) — "what customer-discovery step is worth taking next," a
   * genuinely different question from CEO_DECISION_ACTIONS' "what
   * should happen to this opportunity overall," asked at a different
   * moment. Same agent row, same zero-tool-call/zero-permission
   * boundary, same bounded budget; stores into the SAME ceo_recommendations
   * table (the table doesn't care which action set produced a row).
   * Recommends only — never itself creates an OutreachExperiment or
   * anything else; a human (via the API, §23) decides whether to act
   * on it, the same decoupled-from-mutation discipline every other
   * CEO action in this codebase already follows.
   */
  async recommendCustomerDiscoveryAction(params: RunCeoReasoningParams): Promise<RunOutcome<CeoReasoningResult>> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new ValidationError(`Opportunity ${params.opportunityId} not found`);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { opportunityId: params.opportunityId, mode: "CUSTOMER_DISCOVERY" },
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

        const gaps = await evidenceGapService.listForOpportunity(params.opportunityId);
        const unresolvedGaps = gaps.filter((g) => g.status !== "RESOLVED");
        const [topGap] = [...unresolvedGaps].sort((a, b) => b.impactScore - a.impactScore);

        const experiments = await outreachExperimentRepository.listForOpportunity(params.opportunityId);
        const activeExperiment = experiments.find((e) => e.status === "ACTIVE") ?? null;
        let experimentSummary: CustomerDiscoveryExperimentSummary | null = null;
        if (activeExperiment) {
          const responses = await customerResponseRepository.listForExperiment(activeExperiment.id);
          const analyzed = responses.filter((r) => r.status === "ANALYZED");
          const negative = analyzed.filter((r) => r.classification === "NEGATIVE_SIGNAL" || r.classification === "NOT_INTERESTED");
          // Independent organizations, not independent prospects (docs/M5_ARCHITECTURE_PROPOSAL.md §18) — ten
          // responses from the same company's employees is one organization's worth of corroboration.
          const distinctProspectIds = Array.from(new Set(responses.map((r) => r.prospectId)));
          const prospects = await Promise.all(distinctProspectIds.map((id) => prospectRepository.findById(id)));
          const independentOrganizations = new Set(prospects.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => p.organization)).size;
          experimentSummary = {
            experimentId: activeExperiment.id,
            claimId: activeExperiment.claimId,
            responseCount: responses.length,
            analyzedCount: analyzed.length,
            negativeCount: negative.length,
            independentOrganizations,
          };
        }

        const { value: decision } = await completeWithValidation(handle.callModel, customerDiscoveryDecisionSchema, {
          systemPrompt: CEO_CUSTOMER_DISCOVERY_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: buildCustomerDiscoveryPrompt(opportunity, claims, latestReportByClaimId, topGap ? { claimId: topGap.claimId, description: topGap.description, impactScore: topGap.impactScore } : null, experimentSummary),
            },
          ],
          devFixtureResponse: buildDevCustomerDiscoveryFixture(claims, topGap ? { claimId: topGap.claimId, description: topGap.description } : null, experimentSummary),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const priorityScore = computeDecisionPriority({
          opportunityScore: opportunity.opportunityScore ?? 0,
          confidenceScore: opportunity.confidenceScore ?? 0,
          killRiskScore: 0,
          topEvidenceGapImpactScore: topGap?.impactScore ?? 0,
          maxClaimEIG: topGap?.impactScore ?? 0,
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
          citedValidationReportIds: toJsonString([]),
          confidence: decision.confidence,
          priorityScore,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: `CEO_CUSTOMER_DISCOVERY_RECOMMENDATION_${decision.action}`,
          resourceType: "OPPORTUNITY",
          resourceId: params.opportunityId,
          result: "SUCCESS",
          metadata: { recommendationId: recommendation.id, confidence: decision.confidence, targetClaimId: decision.targetClaimId },
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

  /**
   * The third, distinct entry point (docs/M6_ARCHITECTURE_PROPOSAL.md
   * §32) — "what should happen to this product build next," asked
   * after the engineering pipeline has run. Same agent row, same
   * zero-tool-call/zero-permission boundary, same bounded budget,
   * same shared ceo_recommendations table (keyed by the Product's own
   * opportunityId — the table doesn't care which action set produced
   * a row, mirroring recommendCustomerDiscoveryAction exactly).
   * Recommends only — never itself advances the Product's own status;
   * the factory orchestrator (product-factory.service.ts) and the
   * Human Owner decide what to do with the recommendation.
   */
  async recommendProductBuildAction(params: { agentId: string; productId: string; startedBy: AuthenticatedActor }): Promise<RunOutcome<CeoReasoningResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    const spec = await productSpecRepository.findLatestForProduct(params.productId);
    if (!spec) throw new ValidationError(`Product ${params.productId} has no ProductSpec yet — the Product Strategist must run first.`);
    const groundedInClaimIds = fromJsonString<string[]>(spec.groundedInClaimIds, []);

    const tasks = await engineeringTaskRepository.listForProduct(params.productId);
    let blockingCodeReviewCount = 0;
    let qaFailCount = 0;
    let securityFailCount = 0;
    for (const task of tasks) {
      const [codeReview, qaReport, securityReview] = await Promise.all([
        codeReviewRepository.findLatestForTask(task.id),
        qaReportRepository.findLatestForTask(task.id),
        securityReviewRepository.findLatestForTask(task.id),
      ]);
      if (codeReview?.hasBlockingFinding) blockingCodeReviewCount += 1;
      if (qaReport?.verdict === "FAIL") qaFailCount += 1;
      if (securityReview?.verdict === "FAIL") securityFailCount += 1;
    }
    const outcome: EngineeringTaskOutcomeSummary = {
      taskCount: tasks.length,
      completedCount: tasks.filter((t: EngineeringTask) => t.status === "COMPLETED").length,
      blockingCodeReviewCount,
      qaFailCount,
      securityFailCount,
    };

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId, mode: "PRODUCT_BUILD" },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: decision } = await completeWithValidation(handle.callModel, productBuildDecisionSchema, {
          systemPrompt: CEO_PRODUCT_BUILD_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildProductBuildPrompt(spec, groundedInClaimIds, outcome) }],
          devFixtureResponse: buildDevProductBuildFixture(groundedInClaimIds, outcome),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust the model's own citation on faith — every cited claim id must be real and actually ground this spec.
        const validClaimIds = new Set(groundedInClaimIds);
        const citedClaimIds = decision.citedClaimIds.filter((id) => validClaimIds.has(id));
        if (citedClaimIds.length === 0) {
          throw new ValidationError("Product-build recommendation cited no real, verifiable claim id — refusing to persist an ungrounded recommendation.");
        }

        const priorityScore = computeDecisionPriority({
          opportunityScore: PLACEHOLDER_NEUTRAL_SCORE,
          confidenceScore: decision.confidence,
          killRiskScore: securityFailCount > 0 ? 1 : 0,
          topEvidenceGapImpactScore: PLACEHOLDER_NEUTRAL_SCORE,
          maxClaimEIG: PLACEHOLDER_NEUTRAL_SCORE,
          estimatedResearchCost: PLACEHOLDER_NEUTRAL_SCORE,
          timeSensitivityScore: PLACEHOLDER_NEUTRAL_SCORE,
          strategicFitScore: PLACEHOLDER_NEUTRAL_SCORE,
        });

        const recommendation = await ceoRecommendationRepository.create({
          opportunityId: product.opportunityId,
          decisionCycleId: null,
          action: decision.action,
          reasoning: decision.reasoning,
          citedClaimIds: toJsonString(citedClaimIds),
          citedValidationReportIds: toJsonString([]),
          confidence: decision.confidence,
          priorityScore,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: `CEO_PRODUCT_BUILD_RECOMMENDATION_${decision.action}`,
          resourceType: "PRODUCT",
          resourceId: params.productId,
          result: "SUCCESS",
          metadata: { recommendationId: recommendation.id, confidence: decision.confidence, ...outcome },
        });
        await eventBus.publish({
          type: "CEO_RECOMMENDATION_ISSUED",
          payload: { recommendationId: recommendation.id, opportunityId: product.opportunityId, productId: params.productId, action: decision.action, confidence: decision.confidence },
        });

        return { recommendation };
      },
      CEO_REASONING_BUDGET,
    );
  },
};

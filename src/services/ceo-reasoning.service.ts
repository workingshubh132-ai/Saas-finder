import type { Claim, CeoRecommendation, CompanyRecommendation, EngineeringTask, ProductSpec, ValidationReport } from "@prisma/client";
import { z } from "zod";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { codeReviewRepository } from "../db/repositories/code-review.repository.js";
import { customerResponseRepository } from "../db/repositories/customer-response.repository.js";
import { deploymentPlanRepository } from "../db/repositories/deployment-plan.repository.js";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import { goToMarketPlanRepository } from "../db/repositories/go-to-market-plan.repository.js";
import { launchPlanRepository } from "../db/repositories/launch-plan.repository.js";
import { outreachExperimentRepository } from "../db/repositories/outreach-experiment.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { pricingModelRepository } from "../db/repositories/pricing-model.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { qaReportRepository } from "../db/repositories/qa-report.repository.js";
import { securityReviewRepository } from "../db/repositories/security-review.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { CEO_DECISION_ACTIONS } from "../domain/decision/decision-action.types.js";
import { CUSTOMER_DISCOVERY_ACTIONS } from "../domain/decision/customer-discovery-action.types.js";
import { LAUNCH_OPERATIONS_ACTIONS } from "../domain/decision/launch-operations-action.types.js";
import { PRODUCT_BUILD_ACTIONS } from "../domain/decision/product-build-action.types.js";
import { BUSINESS_ACTIONS, BUSINESS_RELEVANT_CLAIM_TYPES } from "../domain/decision/business-action.types.js";
import { computeDecisionPriority, PLACEHOLDER_NEUTRAL_SCORE } from "../domain/decision/priority.js";
import { COMPANY_ACTIONS } from "../domain/company-action/company-action.types.js";
import { PORTFOLIO_BUCKETS, type CompanyStateDimensions, type PortfolioBucket } from "../domain/company-state/company-state.types.js";
import { checkLaunchBudget } from "../domain/product/launch-budget.js";
import { checkRevenueConcentration } from "../domain/revenue-intelligence/concentration.js";
import type { UnitEconomics } from "../domain/pricing-model/unit-economics.js";
import type { MetricResult } from "../domain/shared/metric-result.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { createRevenueProvider } from "../providers/revenue-provider-factory.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { alertService } from "./alert.service.js";
import { companyStateService } from "./company-state.service.js";
import { concurrencyService } from "./concurrency.service.js";
import { decisionMemoryService, type DecisionMemoryEntry } from "./decision-memory.service.js";
import { eventBus } from "./event-bus.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import { killIntelligenceService } from "./kill-intelligence.service.js";
import { completeWithValidation } from "./model-output.js";
import { portfolioControlService } from "./portfolio-control.service.js";
import { resourceAllocationService } from "./resource-allocation.service.js";

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

const launchOperationsDecisionSchema = z.object({
  action: z.enum(LAUNCH_OPERATIONS_ACTIONS),
  reasoning: z.string().min(1),
  citedClaimIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
});
type LaunchOperationsDecision = z.infer<typeof launchOperationsDecisionSchema>;

interface LaunchPlanSummary {
  environment: string;
  budgetExceeded: boolean;
  estimatedCostUsd: number;
  grossMarginPct: number | null;
  groundedClaimCount: number;
}

const CEO_LAUNCH_OPERATIONS_SYSTEM_PROMPT =
  "You are the CEO of VentureForge, now deciding a launch & operations step (docs/M7_ARCHITECTURE_PROPOSAL.md §28). " +
  "This is a FOURTH, distinct question from your usual opportunity-kill, customer-discovery, or product-build " +
  "decisions: given a product that is ready to launch (its deployment plan, pricing model, and go-to-market plan), " +
  "decide what should happen next. You have no tools and cannot deploy, bill, or spend anything yourself — every " +
  "input is already-established fact. Choose exactly one action: LAUNCH (deployment plan, pricing, and GTM are all " +
  "genuinely ready and within budget — recommend a real human go/no-go decision now); DELAY_LAUNCH (something " +
  "specific is not ready yet, but no fundamental problem exists); REDUCE_COST (the deployment plan's own estimated " +
  "cost exceeds the founder's budget ceiling — this must be resolved before launch); CHANGE_PRICING (unit " +
  "economics are too thin — gross margin is too low to sustain the business); RUN_ACQUISITION_EXPERIMENT (the GTM " +
  "plan's own experiment is worth running before a full launch); REQUEST_CUSTOMER_RESEARCH (the pricing or GTM " +
  "plan is grounded in too few real claims to trust); IMPROVE_PRODUCT (a live product's own metrics suggest the " +
  "product itself needs work before continuing); PAUSE_PRODUCT (a live product should be temporarily paused); " +
  "KILL_PRODUCT (a fundamental problem means this product should not continue); or REQUEST_HUMAN_REVIEW (you " +
  "cannot confidently resolve this yourself — an honest, valid outcome). Every recommendation MUST cite the " +
  "specific claim ids that ground the pricing/GTM plan. " +
  'Respond with ONLY JSON matching: {"action": "LAUNCH"|"DELAY_LAUNCH"|"REDUCE_COST"|"CHANGE_PRICING"|' +
  '"RUN_ACQUISITION_EXPERIMENT"|"REQUEST_CUSTOMER_RESEARCH"|"IMPROVE_PRODUCT"|"PAUSE_PRODUCT"|"KILL_PRODUCT"|' +
  '"REQUEST_HUMAN_REVIEW", "reasoning": string, "citedClaimIds": string[], "confidence": number}';

function buildLaunchOperationsPrompt(summary: LaunchPlanSummary, groundedClaims: readonly Claim[]): string {
  const claimLines = groundedClaims.map((c) => `- [id=${c.id}] [${c.claimType}] status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  return [
    `Deployment environment: ${summary.environment}`,
    `Estimated monthly cost: $${summary.estimatedCostUsd.toFixed(2)}`,
    `Budget exceeded: ${summary.budgetExceeded}`,
    `Gross margin: ${summary.grossMarginPct === null ? "not yet computed (no pricing model)" : `${(summary.grossMarginPct * 100).toFixed(1)}%`}`,
    `Grounded in ${summary.groundedClaimCount} real claim(s).`,
    "",
    `Grounding claims:`,
    ...(claimLines.length > 0 ? claimLines : ["(none)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the
 * launch plan's own real budget/margin/grounding facts, same
 * discipline as buildDevProductBuildFixture.
 */
function buildDevLaunchOperationsFixture(summary: LaunchPlanSummary, groundedClaims: readonly Claim[]): LaunchOperationsDecision {
  const citedClaimIds = groundedClaims.map((c) => c.id);
  if (citedClaimIds.length === 0) {
    throw new ValidationError("Cannot produce a launch-operations recommendation with no grounding claims.");
  }

  if (summary.budgetExceeded) {
    return {
      action: "REDUCE_COST",
      reasoning: `[DEV FIXTURE] Estimated monthly cost $${summary.estimatedCostUsd.toFixed(2)} exceeds the founder-configured budget ceiling — this must be resolved before a human can responsibly approve launch.`,
      citedClaimIds,
      confidence: 0.75,
    };
  }
  if (summary.grossMarginPct !== null && summary.grossMarginPct < 0.2) {
    return {
      action: "CHANGE_PRICING",
      reasoning: `[DEV FIXTURE] Gross margin ${(summary.grossMarginPct * 100).toFixed(1)}% is too thin to sustain the business at the proposed price point.`,
      citedClaimIds,
      confidence: 0.6,
    };
  }
  if (summary.groundedClaimCount < 2) {
    return {
      action: "REQUEST_CUSTOMER_RESEARCH",
      reasoning: `[DEV FIXTURE] The pricing/GTM plan is grounded in only ${summary.groundedClaimCount} real claim(s) — too thin to trust for a real launch decision.`,
      citedClaimIds,
      confidence: 0.5,
    };
  }

  return {
    action: "LAUNCH",
    reasoning: `[DEV FIXTURE] Deployment plan is within budget, gross margin ${summary.grossMarginPct === null ? "is unavailable but no red flag exists" : `is ${(summary.grossMarginPct * 100).toFixed(1)}%`}, and the plan is grounded in ${summary.groundedClaimCount} real claim(s) — ready for a real human go/no-go decision.`,
    citedClaimIds,
    confidence: 0.7,
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

const businessActionDecisionSchema = z.object({
  action: z.enum(BUSINESS_ACTIONS),
  reasoning: z.string().min(1),
  citedClaimIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
});
type BusinessActionDecision = z.infer<typeof businessActionDecisionSchema>;

interface BusinessActionSummary {
  businessHealthState: string;
  compositeScore: number;
  killRecommendation: string;
  combinedKillRiskScore: number;
  budgetExceeded: boolean;
  grossMarginPct: number | null;
  revenueConcentrationRisk: boolean;
  groundedClaimCount: number;
}

const MARGIN_SUSTAINABLE_FLOOR_FOR_CEO = 0.2;

const CEO_BUSINESS_SYSTEM_PROMPT =
  "You are the CEO of VentureForge, now deciding a business-intelligence step (docs/M8_ARCHITECTURE_PROPOSAL.md " +
  "§22). This is a FIFTH, distinct question from your opportunity-kill, customer-discovery, product-build, or " +
  "launch-operations decisions: given everything now observed about how a LIVE product's business is actually " +
  "doing (its BusinessHealth state, kill-risk assessment, budget, margin, and revenue-concentration signal), decide " +
  "what should happen next. You have no tools and cannot invest, change pricing, or kill anything yourself — every " +
  "input is already-established fact. Choose exactly one action: INVEST (the business is genuinely healthy and " +
  "evidence-grounded); IMPROVE_PRODUCT (the product itself needs work before more investment makes sense); " +
  "RUN_EXPERIMENT (a specific uncertainty is worth testing before deciding further); CHANGE_PRICING (margin is too " +
  "thin to sustain); CHANGE_CHANNEL (growth depends on a channel worth reconsidering); INVESTIGATE_CHURN (retention " +
  "or kill-risk signals warrant investigation before any other action); REDUCE_COST (estimated cost exceeds the " +
  "founder's budget ceiling); PAUSE_GROWTH (further growth investment is not warranted right now); " +
  "PREPARE_KILL_REVIEW (kill intelligence recommends it — this still requires Chairman review and a human decision, " +
  "never an automatic kill); KILL (only when the evidence is truly unambiguous — still requires the same review); " +
  "or REQUEST_HUMAN_REVIEW (you cannot confidently resolve this yourself — an honest, valid outcome, and the right " +
  "choice whenever revenue concentration risk is flagged or grounding is thin). Every recommendation MUST cite the " +
  "specific claim ids that ground it. " +
  'Respond with ONLY JSON matching: {"action": "INVEST"|"IMPROVE_PRODUCT"|"RUN_EXPERIMENT"|"CHANGE_PRICING"|' +
  '"CHANGE_CHANNEL"|"INVESTIGATE_CHURN"|"REDUCE_COST"|"PAUSE_GROWTH"|"PREPARE_KILL_REVIEW"|"KILL"|' +
  '"REQUEST_HUMAN_REVIEW", "reasoning": string, "citedClaimIds": string[], "confidence": number}';

function buildBusinessActionPrompt(summary: BusinessActionSummary, groundedClaims: readonly Claim[]): string {
  const claimLines = groundedClaims.map((c) => `- [id=${c.id}] [${c.claimType}] status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  return [
    `BusinessHealth state: ${summary.businessHealthState} (composite score ${summary.compositeScore.toFixed(2)})`,
    `Kill intelligence: ${summary.killRecommendation} (combined kill risk ${summary.combinedKillRiskScore.toFixed(2)})`,
    `Budget exceeded: ${summary.budgetExceeded}`,
    `Gross margin: ${summary.grossMarginPct === null ? "not yet computed" : `${(summary.grossMarginPct * 100).toFixed(1)}%`}`,
    `Revenue concentration risk: ${summary.revenueConcentrationRisk}`,
    `Grounded in ${summary.groundedClaimCount} real claim(s).`,
    "",
    "Grounding claims:",
    ...(claimLines.length > 0 ? claimLines : ["(none)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the
 * product's own real BusinessHealth/kill-intelligence/budget/margin/
 * concentration facts, same discipline as buildDevLaunchOperationsFixture.
 * Rule order (docs/M8_ARCHITECTURE_PROPOSAL.md §22): the kill signal
 * and hard budget/margin/concentration/grounding problems are checked
 * before any positive action is ever considered.
 */
function buildDevBusinessActionFixture(summary: BusinessActionSummary, groundedClaims: readonly Claim[]): BusinessActionDecision {
  const citedClaimIds = groundedClaims.map((c) => c.id);
  if (citedClaimIds.length === 0) {
    throw new ValidationError("Cannot produce a business-action recommendation with no grounding claims.");
  }

  if (summary.killRecommendation === "PREPARE_KILL_REVIEW") {
    return {
      action: "PREPARE_KILL_REVIEW",
      reasoning: `[DEV FIXTURE] Combined kill risk ${summary.combinedKillRiskScore.toFixed(2)} crosses the threshold for a kill review — real post-launch evidence, not merely a stale pre-launch projection.`,
      citedClaimIds,
      confidence: 0.7,
    };
  }
  if (summary.budgetExceeded) {
    return {
      action: "REDUCE_COST",
      reasoning: "[DEV FIXTURE] Estimated monthly operating cost exceeds the founder-configured budget ceiling — this must be resolved before further investment.",
      citedClaimIds,
      confidence: 0.75,
    };
  }
  if (summary.grossMarginPct !== null && summary.grossMarginPct < MARGIN_SUSTAINABLE_FLOOR_FOR_CEO) {
    return {
      action: "CHANGE_PRICING",
      reasoning: `[DEV FIXTURE] Gross margin ${(summary.grossMarginPct * 100).toFixed(1)}% is below the ${MARGIN_SUSTAINABLE_FLOOR_FOR_CEO * 100}% floor — the current price/cost structure does not sustain the business.`,
      citedClaimIds,
      confidence: 0.6,
    };
  }
  if (summary.revenueConcentrationRisk) {
    return {
      action: "REQUEST_HUMAN_REVIEW",
      reasoning: "[DEV FIXTURE] Revenue is concentrated in a small number of subscriptions — a positive trend driven by one customer is not the same as broad-based traction; a human should weigh this before further investment.",
      citedClaimIds,
      confidence: 0.5,
    };
  }
  if (summary.groundedClaimCount < 2) {
    return {
      action: "REQUEST_HUMAN_REVIEW",
      reasoning: `[DEV FIXTURE] Only ${summary.groundedClaimCount} real business claim(s) ground this recommendation — too thin to confidently recommend anything more specific.`,
      citedClaimIds,
      confidence: 0.4,
    };
  }
  if (summary.killRecommendation === "INVESTIGATE" || summary.killRecommendation === "REDUCE_INVESTMENT") {
    return {
      action: "INVESTIGATE_CHURN",
      reasoning: `[DEV FIXTURE] Kill intelligence recommends ${summary.killRecommendation} — retention/churn signals warrant investigation before any further investment decision.`,
      citedClaimIds,
      confidence: 0.55,
    };
  }
  if (summary.businessHealthState === "STAGNATING" || summary.businessHealthState === "DECLINING") {
    return {
      action: "IMPROVE_PRODUCT",
      reasoning: `[DEV FIXTURE] BusinessHealth is ${summary.businessHealthState} — the product itself needs work before more investment is warranted.`,
      citedClaimIds,
      confidence: 0.55,
    };
  }
  if (summary.businessHealthState === "HEALTHY" || summary.businessHealthState === "PROMISING") {
    return {
      action: "INVEST",
      reasoning: `[DEV FIXTURE] BusinessHealth is ${summary.businessHealthState} with composite score ${summary.compositeScore.toFixed(2)}, no budget/margin/concentration problem, and adequate grounding — a real case for further investment.`,
      citedClaimIds,
      confidence: 0.65,
    };
  }
  return {
    action: "REQUEST_HUMAN_REVIEW",
    reasoning: `[DEV FIXTURE] BusinessHealth state ${summary.businessHealthState} does not clear the bar for a confident automated recommendation.`,
    citedClaimIds,
    confidence: 0.4,
  };
}

const companyActionDecisionSchema = z.object({
  action: z.enum(COMPANY_ACTIONS),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  targetOpportunityId: z.string().min(1).nullable().default(null),
  targetProductId: z.string().min(1).nullable().default(null),
});
type CompanyActionDecision = z.infer<typeof companyActionDecisionSchema>;

function formatMetric(result: MetricResult): string {
  if (result.status === "COMPUTED") return result.value.toFixed(2);
  if (result.status === "INSUFFICIENT_DATA") return `INSUFFICIENT_DATA (${result.reason})`;
  return "UNKNOWN";
}

/** Exported only for tests/unit/m9-ceo-company-prompt.test.ts's own direct verification that pastLessons/resourceAllocationConsumedByCategory actually reach the prompt — every other prompt-builder in this file stays private, tested only via its dev fixture's observable decision. */
export interface CompanyActionSummary {
  companyState: CompanyStateDimensions;
  portfolioBucketCounts: Record<PortfolioBucket, number>;
  opportunityCountsByStatus: Record<string, number>;
  productCountsByStatus: Record<string, number>;
  /** "Have we made this mistake before?" (§27, M9 brief §15) — evidentiary, never authoritative: one input line the Chairman may independently contest, exactly like any other cited claim. */
  pastLessons: readonly DecisionMemoryEntry[];
  resourceAllocationConsumedByCategory: Record<string, number>;
}

const CEO_COMPANY_SYSTEM_PROMPT =
  "You are the CEO of VentureForge, now deciding the SIXTH, company-level question (docs/M9_ARCHITECTURE_PROPOSAL.md " +
  "§31-32): given everything now known across the ENTIRE company — Company State (cash/revenue/growth/portfolio " +
  "health/customer health/operational health/risk/evidence quality/decision backlog/execution backlog), Portfolio " +
  "Control (how many products are WINNERS/PROMISING/UNCERTAIN/STAGNATING/DECLINING/KILL CANDIDATES), and the " +
  "Opportunity/Product pipeline counts — what should VentureForge do NEXT, across everything, not any single " +
  "opportunity or product? You have no tools and cannot yourself invest, build, or kill anything; every input is " +
  "already-established fact. Choose exactly one action: RESEARCH (evidence quality or portfolio size is too thin " +
  "to decide anything else responsibly); RUN_CUSTOMER_DISCOVERY (unresolved customer uncertainty outweighs " +
  "everything else); BUILD (a validated opportunity is ready for product work); IMPROVE_PRODUCT (an existing " +
  "product needs work, not new investment); RUN_EXPERIMENT (a specific company-wide uncertainty is worth testing); " +
  "GROW (portfolio health is strong and resources should shift toward growth); REDUCE_COST (operational health or " +
  "risk signals warrant cost discipline); INVEST (the strongest, most evidence-backed opportunity deserves more " +
  "resources); MAINTAIN (the current allocation is already correct — do not manufacture unnecessary change); PAUSE " +
  "(company-wide risk or an unresolved decision backlog warrants slowing down before anything else); or " +
  "PREPARE_KILL_REVIEW (one or more KILL CANDIDATES need a real kill review). If your recommendation concerns one " +
  "specific opportunity or product, name it (targetOpportunityId/targetProductId); otherwise leave both null — a " +
  "company-level recommendation may legitimately target the whole portfolio, not any single item. " +
  'Respond with ONLY JSON matching: {"action": "RESEARCH"|"RUN_CUSTOMER_DISCOVERY"|"BUILD"|"IMPROVE_PRODUCT"|' +
  '"RUN_EXPERIMENT"|"GROW"|"REDUCE_COST"|"INVEST"|"MAINTAIN"|"PAUSE"|"PREPARE_KILL_REVIEW", "reasoning": string, ' +
  '"confidence": number, "targetOpportunityId": string|null, "targetProductId": string|null}';

export function buildCompanyActionPrompt(summary: CompanyActionSummary): string {
  const s = summary.companyState;
  return [
    `Cash position: ${formatMetric(s.cashPosition)}`,
    `Revenue (SUM MRR across LIVE products): ${formatMetric(s.revenue)}`,
    `Growth (AVG growthHealth): ${formatMetric(s.growth)}`,
    `Portfolio size (LIVE+PAUSED products): ${s.portfolioSize}`,
    `Portfolio health (AVG compositeScore): ${formatMetric(s.portfolioHealth)}`,
    `Customer health: ${formatMetric(s.customerHealth)}`,
    `Operational health: ${formatMetric(s.operationalHealth)}`,
    `Risk (AVG kill-risk): ${formatMetric(s.risk)}`,
    `Evidence quality: ${formatMetric(s.evidenceQuality)}`,
    `Decision backlog (unified Human Decision Queue): ${s.decisionBacklog}`,
    `Execution backlog (cycles in EXECUTING): ${s.executionBacklog}`,
    "",
    "Portfolio buckets:",
    ...PORTFOLIO_BUCKETS.map((bucket) => `- ${bucket}: ${summary.portfolioBucketCounts[bucket]}`),
    "",
    "Opportunity pipeline (by status):",
    ...Object.entries(summary.opportunityCountsByStatus).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "Product pipeline (by status):",
    ...Object.entries(summary.productCountsByStatus).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "Resource allocation consumed this period (by category):",
    ...(Object.keys(summary.resourceAllocationConsumedByCategory).length > 0
      ? Object.entries(summary.resourceAllocationConsumedByCategory).map(([category, consumed]) => `- ${category}: ${consumed}`)
      : ["- (none recorded yet this period)"]),
    "",
    "Past company-level decisions that generated a real lesson (evidentiary, not authoritative — weigh it, don't defer to it blindly):",
    ...(summary.pastLessons.length > 0
      ? summary.pastLessons.map((entry) => `- ${entry.learningRecord?.lesson ?? "(lesson pending)"}`)
      : ["- (no past company-level decision has generated a lesson yet)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, rule-based, derived from the
 * company's own real Company State/Portfolio Control facts, same
 * discipline as buildDevBusinessActionFixture. Rule order
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §32): thin evidence and a real
 * kill-candidate signal are checked before any growth/investment
 * action is ever considered, mirroring Constitution §19's own
 * kill-review-first discipline.
 */
function buildDevCompanyActionFixture(summary: CompanyActionSummary): CompanyActionDecision {
  const s = summary.companyState;
  if (s.portfolioSize === 0) {
    return { action: "RESEARCH", reasoning: "[DEV FIXTURE] The portfolio is empty — nothing to invest in, improve, or kill yet; the next real step is discovering opportunities.", confidence: 0.6, targetOpportunityId: null, targetProductId: null };
  }
  if (summary.portfolioBucketCounts.KILL_CANDIDATES > 0) {
    return {
      action: "PREPARE_KILL_REVIEW",
      reasoning: `[DEV FIXTURE] ${summary.portfolioBucketCounts.KILL_CANDIDATES} product(s) are in the KILL_CANDIDATES bucket — a real kill review outranks any new investment decision.`,
      confidence: 0.7,
      targetOpportunityId: null,
      targetProductId: null,
    };
  }
  if (s.evidenceQuality.status !== "COMPUTED" || s.evidenceQuality.value < 0.4) {
    return { action: "RESEARCH", reasoning: "[DEV FIXTURE] Evidence quality across the portfolio is too thin (UNKNOWN or below 0.40) to responsibly recommend growth or investment.", confidence: 0.55, targetOpportunityId: null, targetProductId: null };
  }
  if (s.risk.status === "COMPUTED" && s.risk.value >= 0.6) {
    return { action: "REDUCE_COST", reasoning: `[DEV FIXTURE] Average portfolio risk (${s.risk.value.toFixed(2)}) is elevated — cost discipline before further growth.`, confidence: 0.6, targetOpportunityId: null, targetProductId: null };
  }
  if (summary.portfolioBucketCounts.WINNERS > 0 && s.portfolioHealth.status === "COMPUTED" && s.portfolioHealth.value >= 0.6) {
    return {
      action: "GROW",
      reasoning: `[DEV FIXTURE] ${summary.portfolioBucketCounts.WINNERS} product(s) are WINNERS and portfolio health (${s.portfolioHealth.value.toFixed(2)}) is strong — resources should shift toward growth.`,
      confidence: 0.65,
      targetOpportunityId: null,
      targetProductId: null,
    };
  }
  return { action: "MAINTAIN", reasoning: "[DEV FIXTURE] No dimension crosses a threshold that warrants changing the current allocation — maintaining is the honest recommendation, not manufactured action.", confidence: 0.5, targetOpportunityId: null, targetProductId: null };
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

  /**
   * The fourth, distinct entry point (docs/M7_ARCHITECTURE_PROPOSAL.md
   * §28) — "what should happen to this product's launch or ongoing
   * operation next," asked once a LaunchPlan exists. Same agent row,
   * same zero-tool-call/zero-permission boundary, same bounded budget,
   * same shared ceo_recommendations table (keyed by the Product's own
   * opportunityId, mirroring recommendProductBuildAction exactly).
   * Recommends only — LAUNCH never itself creates a DeploymentPlan,
   * KILL_PRODUCT never itself archives the Product; a human decides
   * through the ordinary PLAN/APPROVE/EXECUTE or productService-level
   * paths (docs/SAAS_FACTORY.md's own "recommendations are not
   * execution permissions" precedent, unchanged).
   */
  async recommendLaunchOperationsAction(params: { agentId: string; productId: string; startedBy: AuthenticatedActor }): Promise<RunOutcome<CeoReasoningResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    const launchPlan = await launchPlanRepository.findLatestForProduct(params.productId);
    if (!launchPlan) throw new ValidationError(`Product ${params.productId} has no LaunchPlan yet — the Launch Strategist must run first.`);

    const [deploymentPlan, pricingModel, goToMarketPlan] = await Promise.all([
      launchPlan.deploymentPlanId ? deploymentPlanRepository.findById(launchPlan.deploymentPlanId) : Promise.resolve(null),
      launchPlan.pricingModelId ? pricingModelRepository.findById(launchPlan.pricingModelId) : Promise.resolve(null),
      launchPlan.goToMarketPlanId ? goToMarketPlanRepository.findById(launchPlan.goToMarketPlanId) : Promise.resolve(null),
    ]);

    const groundedClaimIds = Array.from(
      new Set([...(pricingModel ? fromJsonString<string[]>(pricingModel.groundedInClaimIds, []) : []), ...(goToMarketPlan ? fromJsonString<string[]>(goToMarketPlan.groundedInClaimIds, []) : [])]),
    );
    const claims = await claimRepository.listForOpportunity(product.opportunityId);
    const groundedClaims = claims.filter((c) => groundedClaimIds.includes(c.id));

    const unitEconomics = pricingModel ? fromJsonString<UnitEconomics>(pricingModel.unitEconomics, { costPerCustomerUsd: 0, grossMarginUsd: 0, grossMarginPct: 0, reasoning: "" }) : null;

    const summary: LaunchPlanSummary = {
      environment: deploymentPlan?.environment ?? "(no deployment plan)",
      budgetExceeded: deploymentPlan?.budgetExceeded ?? false,
      estimatedCostUsd: deploymentPlan?.estimatedCostUsd ?? 0,
      grossMarginPct: unitEconomics?.grossMarginPct ?? null,
      groundedClaimCount: groundedClaims.length,
    };

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId, mode: "LAUNCH_OPERATIONS" },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: decision } = await completeWithValidation(handle.callModel, launchOperationsDecisionSchema, {
          systemPrompt: CEO_LAUNCH_OPERATIONS_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildLaunchOperationsPrompt(summary, groundedClaims) }],
          devFixtureResponse: buildDevLaunchOperationsFixture(summary, groundedClaims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const validClaimIds = new Set(groundedClaims.map((c) => c.id));
        const citedClaimIds = decision.citedClaimIds.filter((id) => validClaimIds.has(id));
        if (citedClaimIds.length === 0) {
          throw new ValidationError("Launch-operations recommendation cited no real, verifiable claim id — refusing to persist an ungrounded recommendation.");
        }

        const priorityScore = computeDecisionPriority({
          opportunityScore: PLACEHOLDER_NEUTRAL_SCORE,
          confidenceScore: decision.confidence,
          killRiskScore: summary.budgetExceeded ? 1 : 0,
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
          action: `CEO_LAUNCH_OPERATIONS_RECOMMENDATION_${decision.action}`,
          resourceType: "PRODUCT",
          resourceId: params.productId,
          result: "SUCCESS",
          metadata: { recommendationId: recommendation.id, confidence: decision.confidence, ...summary },
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

  /**
   * The fifth, distinct entry point (docs/M8_ARCHITECTURE_PROPOSAL.md
   * §22) — "given everything we now observe about how this business is
   * actually doing, what should happen next," asked of a LIVE (or
   * PAUSED) product once its intelligence agents have run and a
   * BusinessHealth snapshot exists. Same agent row, same zero-tool-
   * call/zero-permission boundary, same bounded budget, same shared
   * ceo_recommendations table. Recommends only — INVEST never itself
   * spends, PREPARE_KILL_REVIEW/KILL never itself changes Product
   * status; a human decides through BusinessReviewMemo (§23, §25).
   */
  async recommendBusinessAction(params: { agentId: string; productId: string; startedBy: AuthenticatedActor }): Promise<RunOutcome<CeoReasoningResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    const health = await businessHealthRepository.findLatestForProduct(params.productId);
    if (!health) throw new ValidationError(`Product ${params.productId} has no BusinessHealth snapshot yet — the intelligence agents must run first.`);

    const scoreRecords = await opportunityRepository.listScoreRecords(product.opportunityId);
    const killAssessment = killIntelligenceService.assess({
      priorOpportunityKillRiskScore: scoreRecords[0]?.killRiskScore ?? 0,
      retentionHealth: health.customerHealth,
      revenueHealth: health.revenueHealth,
      growthHealth: health.growthHealth,
      marginHealth: health.marginHealth,
      evidenceConfidence: health.evidenceConfidence,
    });

    const [costMetric, marginMetric] = await Promise.all([
      businessMetricRepository.findLatestForProductByType(params.productId, "MONTHLY_OPERATING_COST_USD"),
      businessMetricRepository.findLatestForProductByType(params.productId, "GROSS_MARGIN_PCT"),
    ]);
    const budgetCheck = checkLaunchBudget({ estimatedMonthlyCostUsd: costMetric?.value ?? 0 });

    const activeSubs = await createRevenueProvider().listSubscriptionsAsOf(params.productId, new Date());
    const concentration = checkRevenueConcentration(activeSubs.map((s) => s.monthlyValueUsd));

    const claims = await claimRepository.listForOpportunity(product.opportunityId);
    const groundedClaims = claims.filter((c) => BUSINESS_RELEVANT_CLAIM_TYPES.has(c.claimType));

    const summary: BusinessActionSummary = {
      businessHealthState: health.state,
      compositeScore: health.compositeScore,
      killRecommendation: killAssessment.recommendation,
      combinedKillRiskScore: killAssessment.combinedKillRiskScore,
      budgetExceeded: budgetCheck.budgetExceeded,
      grossMarginPct: marginMetric?.value ?? null,
      revenueConcentrationRisk: concentration.isConcentrated,
      groundedClaimCount: groundedClaims.length,
    };

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId, mode: "BUSINESS_ACTION" },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: decision } = await completeWithValidation(handle.callModel, businessActionDecisionSchema, {
          systemPrompt: CEO_BUSINESS_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildBusinessActionPrompt(summary, groundedClaims) }],
          devFixtureResponse: buildDevBusinessActionFixture(summary, groundedClaims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const validClaimIds = new Set(groundedClaims.map((c) => c.id));
        const citedClaimIds = decision.citedClaimIds.filter((id) => validClaimIds.has(id));
        if (citedClaimIds.length === 0) {
          throw new ValidationError("Business-action recommendation cited no real, verifiable claim id — refusing to persist an ungrounded recommendation.");
        }

        const priorityScore = computeDecisionPriority({
          opportunityScore: PLACEHOLDER_NEUTRAL_SCORE,
          confidenceScore: decision.confidence,
          killRiskScore: killAssessment.combinedKillRiskScore,
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
          action: `CEO_BUSINESS_ACTION_RECOMMENDATION_${decision.action}`,
          resourceType: "PRODUCT",
          resourceId: params.productId,
          result: "SUCCESS",
          metadata: { recommendationId: recommendation.id, confidence: decision.confidence, ...summary },
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

  /**
   * The SIXTH, company-level entry point (docs/M9_ARCHITECTURE_PROPOSAL.md
   * §31) — the widest input summary any CEO axis in this codebase has
   * ever received: Company State + Portfolio Control + the Opportunity/
   * Product pipelines + Resource Allocation + decisionMemoryService's
   * own "past mistakes" lookup (a real gap this build caught: an
   * earlier version's own doc comment said these two would be "added
   * once those services exist," but neither task #203 nor #206 ever
   * came back to actually wire them in — both services existed with no
   * caller feeding their output into this prompt at all). Persists a
   * `CompanyRecommendation`, not a `CeoRecommendation` — this axis's own
   * table, since a company-level recommendation may legitimately target
   * zero, one, or the whole portfolio, unlike every other axis's
   * required, single-opportunity FK (docs/DECISIONS.md's own M9 entry).
   */
  async recommendCompanyAction(params: { agentId: string; startedBy: AuthenticatedActor; operatingCycleId?: string | null }): Promise<RunOutcome<{ recommendation: CompanyRecommendation }>> {
    const [companyState, portfolio, allOpportunities, allProducts, resourceAllocations, pastLessons] = await Promise.all([
      companyStateService.getState(),
      portfolioControlService.overview(),
      opportunityRepository.list(),
      productRepository.list(),
      resourceAllocationService.getForPeriod(),
      decisionMemoryService.findSimilarPastDecisions("COMPANY_RECOMMENDATION"),
    ]);

    const portfolioBucketCounts = Object.fromEntries(PORTFOLIO_BUCKETS.map((bucket) => [bucket, portfolio[bucket].length])) as Record<PortfolioBucket, number>;
    const opportunityCountsByStatus: Record<string, number> = {};
    for (const o of allOpportunities) opportunityCountsByStatus[o.status] = (opportunityCountsByStatus[o.status] ?? 0) + 1;
    const productCountsByStatus: Record<string, number> = {};
    for (const p of allProducts) productCountsByStatus[p.status] = (productCountsByStatus[p.status] ?? 0) + 1;
    const resourceAllocationConsumedByCategory: Record<string, number> = {};
    for (const a of resourceAllocations) resourceAllocationConsumedByCategory[a.category] = a.consumed;

    const summary: CompanyActionSummary = { companyState, portfolioBucketCounts, opportunityCountsByStatus, productCountsByStatus, pastLessons, resourceAllocationConsumedByCategory };
    const validOpportunityIds = new Set(allOpportunities.map((o) => o.id));
    const validProductIds = new Set(allProducts.map((p) => p.id));

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { mode: "COMPANY_ACTION" },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: decision } = await completeWithValidation(handle.callModel, companyActionDecisionSchema, {
          systemPrompt: CEO_COMPANY_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildCompanyActionPrompt(summary) }],
          devFixtureResponse: buildDevCompanyActionFixture(summary),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust a model-supplied id at face value (the same discipline every citedClaimIds filter in this file already applies) — a hallucinated target is silently dropped, not persisted.
        const targetOpportunityId = decision.targetOpportunityId && validOpportunityIds.has(decision.targetOpportunityId) ? decision.targetOpportunityId : null;
        const targetProductId = decision.targetProductId && validProductIds.has(decision.targetProductId) ? decision.targetProductId : null;

        // Concurrency conflict detection (docs/M9_ARCHITECTURE_PROPOSAL.md §40) — a human-visible flag, never a
        // database lock; the older pending recommendation is never silently superseded, only annotated alongside it.
        const concurrency = await concurrencyService.checkCompanyRecommendationConflict(decision.action, targetOpportunityId, targetProductId);
        if (concurrency.conflicting && concurrency.conflictingRecommendationId) {
          await alertService.raise({
            alertType: "CONCURRENT_CONFLICT",
            severity: "WARNING",
            resourceType: "COMPANY_RECOMMENDATION",
            resourceId: concurrency.conflictingRecommendationId,
            message: `A new ${decision.action} recommendation conflicts with pending recommendation ${concurrency.conflictingRecommendationId} — a human must resolve which stands.`,
          });
        }
        const reasoning = concurrency.conflicting
          ? `[CONCURRENT_CONFLICT with recommendation ${concurrency.conflictingRecommendationId}, still pending human review] ${decision.reasoning}`
          : decision.reasoning;
        const citedResourceIds = Array.from(
          new Set([
            ...(targetOpportunityId ? [targetOpportunityId] : []),
            ...(targetProductId ? [targetProductId] : []),
            ...(concurrency.conflictingRecommendationId ? [concurrency.conflictingRecommendationId] : []),
            ...allProducts.map((p) => p.id),
          ]),
        );

        const recommendation = await companyRecommendationRepository.create({
          action: decision.action,
          reasoning,
          targetOpportunityId,
          targetProductId,
          citedResourceIds: toJsonString(citedResourceIds),
          confidence: decision.confidence,
          operatingCycleId: params.operatingCycleId ?? null,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: `CEO_COMPANY_ACTION_RECOMMENDATION_${decision.action}`,
          resourceType: "COMPANY",
          resourceId: recommendation.id,
          result: "SUCCESS",
          metadata: { confidence: decision.confidence, targetOpportunityId, targetProductId, concurrentConflict: concurrency.conflicting, conflictingRecommendationId: concurrency.conflictingRecommendationId },
        });
        // Reused verbatim (docs/M9_ARCHITECTURE_PROPOSAL.md §42) — the same event every other CEO axis already fires.
        await eventBus.publish({
          type: "CEO_RECOMMENDATION_ISSUED",
          payload: { companyRecommendationId: recommendation.id, action: decision.action, confidence: decision.confidence, targetOpportunityId, targetProductId },
        });

        return { recommendation };
      },
      CEO_REASONING_BUDGET,
    );
  },
};

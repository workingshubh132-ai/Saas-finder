import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import type { DomainEventInput } from "../domain/events/event.types.js";
import { claimConfidenceService } from "./claim-confidence.service.js";
import { claimExtractionService } from "./claim-extraction.service.js";
import { type Actor } from "./agent.service.js";
import { approvalService } from "./approval.service.js";
import { billingActivationService } from "./billing-activation.service.js";
import { billingPlanService } from "./billing-plan.service.js";
import { chairmanService } from "./chairman.service.js";
import { decisionRecordService } from "./decision-record.service.js";
import { deploymentPlanService } from "./deployment-plan.service.js";
import { deploymentService } from "./deployment.service.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import { evidenceValidatorService } from "./evidence-validator.service.js";
import { eventBus } from "./event-bus.js";
import { growthExperimentExecutionService } from "./growth-experiment-execution.service.js";
import { growthExperimentService } from "./growth-experiment.service.js";
import { identityService } from "./identity.service.js";
import { investmentMemoService } from "./investment-memo.service.js";
import { messageApprovalService } from "./message-approval.service.js";
import { outboundMessageService } from "./outbound-message.service.js";
import { productFactoryService } from "./product-factory.service.js";
import { responseAnalystService } from "./response-analyst.service.js";

/**
 * The minimum orchestration layer Autonomous Operations Phase A adds
 * (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) — observes company state via
 * real events, determines eligible next actions with plain
 * deterministic code (never a model call of its own), and dispatches
 * the exact existing service that already gated each step. Holds no
 * Guardian permission and calls no service it isn't already permitted
 * to call; every consequential step still goes through the same
 * approval/Chairman/budget/Emergency-Stop chain every prior milestone
 * built. Not a second CEO, not a second approval engine — it reasons
 * about NOTHING; it only checks "is this now structurally eligible?"
 * and calls the one real function that does the work.
 *
 * Deliberately scoped to two categories this pass (see the final Phase
 * A report for what's consciously deferred and why):
 *  1. Automatic resumption after a human approval decision (brief item
 *     8) — needs no configuration, works the moment handlers are
 *     registered.
 *  2. Two further reactions that need to know which existing agent
 *     plays which role (there is no "the one CEO" global lookup in
 *     this codebase — agent identity has always been explicit) —
 *     gated behind `configure()`; until called, events for these two
 *     reactions are safely no-ops, not errors.
 */
export const SYSTEM_ACTOR: Actor = { actorType: "SYSTEM", actorId: "autonomous-operations" };

const SYSTEM_IDENTITY_LABEL = "Autonomous Operations";
let cachedSystemIdentityId: string | null = null;

export interface AutonomousOperationsConfig {
  /** Runs the per-opportunity CEO -> Chairman -> Investment Memo -> approval-request chain automatically once an opportunity clears M3's own promotion bar. */
  ceoAgentId?: string;
  evidenceValidatorAgentId?: string;
  /** Runs Response Analyst automatically the moment a real customer response is recorded. */
  responseAnalystAgentId?: string;
  /** Runs the unmodified M6 factory automatically the moment a human approves a Product (brief item 19) — every one of these seven ids is a real, already-required productFactoryService.build() parameter, never a new role. */
  productFactory?: {
    strategistAgentId: string;
    architectAgentId: string;
    uxAgentId: string;
    engineeringAgentId: string;
    codeReviewAgentId: string;
    qaAgentId: string;
    securityAgentId: string;
  };
}

let activeConfig: AutonomousOperationsConfig = {};

/**
 * Idempotent find-or-create — the one SYSTEM identity every
 * `AuthenticatedActor`-shaped automated call uses (agentRuntimeService
 * requires a real, persisted Identity id — `AgentExecution.startedByIdentityId`
 * is a Restrict FK, docs/AUTONOMOUS_OPERATIONS_AUDIT.md). A human must
 * create it once (identityService.createIdentity requires an
 * authenticated HUMAN, or the one-time fresh-deployment bootstrap) —
 * itself a deliberate, audited act, exactly like creating any other
 * identity.
 */
export async function ensureSystemIdentity(createdBy: AuthenticatedActor): Promise<string> {
  if (cachedSystemIdentityId) return cachedSystemIdentityId;
  const { identity } = await identityService.createIdentity({ type: "SYSTEM", label: SYSTEM_IDENTITY_LABEL, createdBy });
  cachedSystemIdentityId = identity.id;
  return identity.id;
}

function systemAuthenticatedActor(): AuthenticatedActor {
  if (!cachedSystemIdentityId) {
    throw new Error("autonomousOperationsService: ensureSystemIdentity() has not been called yet — call it once during company bootstrap before registering handlers that need it.");
  }
  return { type: "SYSTEM", id: cachedSystemIdentityId, identityId: cachedSystemIdentityId };
}

/** Test-only: resets cached configuration/identity so a test starts clean. */
export function resetAutonomousOperationsForTests(): void {
  cachedSystemIdentityId = null;
  activeConfig = {};
}

async function handleHumanDecisionMade(payload: Record<string, unknown>): Promise<void> {
  if (payload.source !== "APPROVAL_REQUEST" || typeof payload.approvalRequestId !== "string") return;
  const approvalRequest = await approvalService.getOrThrow(payload.approvalRequestId);

  switch (approvalRequest.resourceType) {
    case "OUTREACH_MESSAGE": {
      const message = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: SYSTEM_ACTOR });
      if (message.status === "APPROVED_TO_CONTACT") {
        await outboundMessageService.send({ outreachMessageId: message.id, actor: SYSTEM_ACTOR });
      }
      return;
    }
    case "DEPLOYMENT_PLAN": {
      const plan = await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: SYSTEM_ACTOR });
      if (plan.status === "HUMAN_APPROVED") {
        await deploymentService.execute({ deploymentPlanId: plan.id, actor: SYSTEM_ACTOR });
      }
      return;
    }
    case "BILLING_PLAN": {
      const plan = await billingPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: SYSTEM_ACTOR });
      if (plan.status === "HUMAN_APPROVED") {
        await billingActivationService.activate({ billingPlanId: plan.id, actor: SYSTEM_ACTOR });
      }
      return;
    }
    case "OPPORTUNITY": {
      await decisionRecordService.applyHumanDecision({ approvalRequestId: approvalRequest.id, actor: SYSTEM_ACTOR });
      return;
    }
    case "GROWTH_EXPERIMENT": {
      const experiment = await growthExperimentService.applyDecision({ approvalRequestId: approvalRequest.id, actor: SYSTEM_ACTOR });
      if (experiment.status === "APPROVED") {
        await growthExperimentExecutionService.approveToRun({ growthExperimentId: experiment.id, actor: SYSTEM_ACTOR });
      }
      return;
    }
    default:
      // An unrecognized resourceType gets no automatic follow-up — left for a human, never guessed at.
      return;
  }
}

async function handleCustomerResponseRecorded(payload: Record<string, unknown>): Promise<void> {
  // customerResponseService.record's own real, unmodified event payload names this field `responseId` (customer-response.service.ts) — matched here, not renamed there.
  if (!activeConfig.responseAnalystAgentId || typeof payload.responseId !== "string") return;
  await responseAnalystService.run({ agentId: activeConfig.responseAnalystAgentId, customerResponseId: payload.responseId, startedBy: systemAuthenticatedActor() });
}

/**
 * The per-opportunity chain M10's own opportunity-selection script ran
 * by hand: claim extraction -> evidence validation -> confidence ->
 * CEO -> Chairman -> Investment Memo -> approval request (only when
 * the CEO's action requires one). Every step here is the exact same
 * unmodified M4 call a human-driven script already used; this handler
 * only removes the manual "run the next script" step between them.
 */
async function handleOpportunityDiscovered(payload: Record<string, unknown>): Promise<void> {
  if (!activeConfig.ceoAgentId || !activeConfig.evidenceValidatorAgentId || typeof payload.opportunityId !== "string") return;
  const opportunityId = payload.opportunityId;
  const actor = systemAuthenticatedActor();

  const claims = await claimExtractionService.extractForOpportunity({ opportunityId, actorType: "SYSTEM", actorId: actor.id });
  for (const claim of claims) {
    const outcome = await evidenceValidatorService.run({ agentId: activeConfig.evidenceValidatorAgentId, claimId: claim.id, maxSearches: 0, startedBy: actor });
    if (outcome.status !== "COMPLETED") continue;
    const updated = await claimConfidenceService.recalculateFromLatestReport({ claimId: claim.id, actorType: "SYSTEM", actorId: actor.id });
    await evidenceGapService.analyzeClaim({ claim: updated, recommendedResearch: null });
  }
  await claimConfidenceService.recalculateOpportunityConfidence({ opportunityId, scoredBy: actor.id });

  const ceoOutcome = await ceoReasoningServiceRun(opportunityId, actor);
  if (ceoOutcome.status !== "COMPLETED") return;
  const rec = ceoOutcome.result.recommendation;

  const chairmanResult = await chairmanService.review({ opportunityId, reviewedBy: actor });
  const { memo } = await investmentMemoService.compile({ opportunityId, ceoRecommendationId: rec.id, chairmanReviewId: chairmanResult.review.id, actorType: "SYSTEM", actorId: actor.id });
  void memo; // compiled and persisted for the founder to read; nothing further to dispatch from it automatically.

  await decisionRecordService.requestApprovalForRecommendation({ ceoRecommendationId: rec.id, requestedByAgentId: activeConfig.ceoAgentId });
}

/**
 * The unmodified M6 factory, triggered the moment a human approves a
 * Product (brief item 19) — never a second factory, never a bypass of
 * any of its own internal stop conditions (failing tests, security
 * findings, budget exhaustion, dependency violations all still stop
 * the SAME real build this call already ran before Phase A existed).
 */
async function handlePlatformProductApproved(payload: Record<string, unknown>): Promise<void> {
  const pf = activeConfig.productFactory;
  if (!pf || !activeConfig.ceoAgentId || typeof payload.productId !== "string") return;
  await productFactoryService.build({
    productId: payload.productId,
    strategistAgentId: pf.strategistAgentId,
    architectAgentId: pf.architectAgentId,
    uxAgentId: pf.uxAgentId,
    engineeringAgentId: pf.engineeringAgentId,
    codeReviewAgentId: pf.codeReviewAgentId,
    qaAgentId: pf.qaAgentId,
    securityAgentId: pf.securityAgentId,
    ceoAgentId: activeConfig.ceoAgentId,
    startedBy: systemAuthenticatedActor(),
  });
}

// Isolated behind a tiny indirection so a circular-import edge (ceo-reasoning.service.ts is large and itself imports many services) never risks becoming one — see docs/DECISIONS.md if this needs revisiting.
async function ceoReasoningServiceRun(opportunityId: string, actor: AuthenticatedActor) {
  const { ceoReasoningService } = await import("./ceo-reasoning.service.js");
  if (!activeConfig.ceoAgentId) throw new Error("unreachable — checked by caller");
  return ceoReasoningService.run({ agentId: activeConfig.ceoAgentId, opportunityId, startedBy: actor });
}

async function dispatch(event: DomainEventInput): Promise<void> {
  switch (event.type) {
    case "HUMAN_DECISION_MADE":
      return handleHumanDecisionMade(event.payload);
    case "CUSTOMER_RESPONSE_RECORDED":
      return handleCustomerResponseRecorded(event.payload);
    case "OPPORTUNITY_DISCOVERED":
      return handleOpportunityDiscovered(event.payload);
    case "PRODUCT_APPROVED":
      return handlePlatformProductApproved(event.payload);
    default:
      return;
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Call once at process startup (mirrors registerDefaultTools()'s own
 * pattern). Safe to call again — re-registering replaces the previous
 * subscription and config rather than stacking a second one.
 */
export function registerAutonomousOperationsHandlers(config: AutonomousOperationsConfig = {}): () => void {
  if (unsubscribe) unsubscribe();
  activeConfig = config;
  unsubscribe = eventBus.subscribe(dispatch);
  return unsubscribe;
}

export const autonomousOperationsService = {
  SYSTEM_ACTOR,
  ensureSystemIdentity,
  registerAutonomousOperationsHandlers,
};

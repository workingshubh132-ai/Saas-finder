import type { BusinessHealth, BusinessReviewMemo, CeoRecommendation, ChairmanReview, Product } from "@prisma/client";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { deriveBusinessHealth, type BusinessHealthDimensions } from "../domain/business-health/business-health.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { alertService } from "./alert.service.js";
import { auditService } from "./audit.service.js";
import { businessClaimExtractionService } from "./business-claim-extraction.service.js";
import { businessReviewMemoService } from "./business-review-memo.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { chairmanService } from "./chairman.service.js";
import { customerIntelligenceService } from "./customer-intelligence.service.js";
import { growthAnalystService } from "./growth-analyst.service.js";
import { incidentService } from "./incident.service.js";
import { productIntelligenceService } from "./product-intelligence.service.js";
import { productService } from "./product.service.js";
import { revenueAnalystService } from "./revenue-analyst.service.js";

export interface AnalyzeBusinessParams {
  productId: string;
  productIntelligenceAgentId: string;
  revenueAnalystAgentId: string;
  growthAnalystAgentId: string;
  customerIntelligenceAgentId: string;
  ceoAgentId: string;
  startedBy: AuthenticatedActor;
}

export interface BusinessIntelligenceSummary {
  product: Product;
  businessHealth: BusinessHealth | null;
  ceoRecommendation: CeoRecommendation | null;
  chairmanReview: ChairmanReview | null;
  memo: BusinessReviewMemo | null;
  stoppedReason: string | null;
}

function toActor(startedBy: AuthenticatedActor): { actorType: "HUMAN" | "AGENT" | "SYSTEM"; actorId: string } {
  return { actorType: startedBy.type, actorId: startedBy.id };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The business-intelligence orchestrator (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §2) — deterministic orchestration CODE, layered on top of unmodified
 * agent services, mirroring launchOperationsService's own precedent
 * (M7) exactly: runs the four intelligence agents, extracts/updates
 * real Claims from their output, computes a BusinessHealth snapshot,
 * then runs CEO -> Chairman -> BusinessReviewMemo. Stops cleanly and
 * preserves every already-committed row on any failure, never rolls
 * back partial work. Never itself changes Product status beyond what
 * the memo's own recordHumanDecision later does.
 */
export const businessIntelligenceService = {
  async analyze(params: AnalyzeBusinessParams): Promise<BusinessIntelligenceSummary> {
    const product = await productService.getOrThrow(params.productId);
    if (product.status !== "LIVE" && product.status !== "PAUSED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — business intelligence only runs against a LIVE (or PAUSED) product.`);
    }
    const actor = toActor(params.startedBy);

    const fail = async (reason: string): Promise<BusinessIntelligenceSummary> => {
      await auditService.record({ actorType: actor.actorType, actorId: actor.actorId, action: "BUSINESS_INTELLIGENCE_STOPPED", resourceType: "PRODUCT", resourceId: product.id, result: "FAILURE", reason });
      return { product, businessHealth: null, ceoRecommendation: null, chairmanReview: null, memo: null, stoppedReason: reason };
    };

    const piOutcome = await productIntelligenceService.run({ agentId: params.productIntelligenceAgentId, productId: product.id, startedBy: params.startedBy });
    if (piOutcome.status !== "COMPLETED") return fail("Product Intelligence Agent did not complete.");

    const raOutcome = await revenueAnalystService.run({ agentId: params.revenueAnalystAgentId, productId: product.id, startedBy: params.startedBy });
    if (raOutcome.status !== "COMPLETED") return fail("Revenue Analyst did not complete.");

    const gaOutcome = await growthAnalystService.run({ agentId: params.growthAnalystAgentId, productId: product.id, startedBy: params.startedBy });
    if (gaOutcome.status !== "COMPLETED") return fail("Growth Analyst did not complete.");

    const ciOutcome = await customerIntelligenceService.run({ agentId: params.customerIntelligenceAgentId, productId: product.id, startedBy: params.startedBy });
    if (ciOutcome.status !== "COMPLETED") return fail("Customer Intelligence Agent did not complete.");

    const pi = piOutcome.result.output;
    const piSummary = piOutcome.result.summary;
    const ra = raOutcome.result.output;
    const raSummary = raOutcome.result.summary;
    const ga = gaOutcome.result.output;
    const ci = ciOutcome.result.output;

    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "WILLINGNESS_TO_PAY",
      statementIfNew: `Post-launch revenue signal: ${ra.summary}`,
      confidence: ra.confidence,
      agentId: params.revenueAnalystAgentId,
      evidenceText: ra.summary,
      evidenceSource: "revenue-analyst",
    });
    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "ECONOMICS",
      statementIfNew: `Post-launch margin sustainability: ${ra.marginIsSustainable ? "sustainable" : "not yet sustainable"} — ${ra.summary}`,
      confidence: ra.confidence,
      agentId: params.revenueAnalystAgentId,
      evidenceText: ra.reasoning,
      evidenceSource: "revenue-analyst",
    });
    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "RETENTION",
      statementIfNew: `Post-launch retention/activation: ${pi.reasoning}`,
      confidence: pi.confidence,
      agentId: params.productIntelligenceAgentId,
      evidenceText: [...pi.strengths, ...pi.weaknesses].join(" "),
      evidenceSource: "product-intelligence",
    });
    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "DISTRIBUTION",
      statementIfNew: `Post-launch growth channel signal: ${ga.summary}`,
      confidence: ga.confidence,
      agentId: params.growthAnalystAgentId,
      evidenceText: ga.promisingChannel ?? ga.bottleneck ?? ga.summary,
      evidenceSource: "growth-analyst",
    });
    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "CUSTOMER_SEGMENT",
      statementIfNew: `Post-launch customer segment signal: ${ci.reasoning}`,
      confidence: ci.confidence,
      agentId: params.customerIntelligenceAgentId,
      evidenceText: ci.reasoning,
      evidenceSource: "customer-intelligence",
    });
    await businessClaimExtractionService.upsertClaim({
      opportunityId: product.opportunityId,
      claimType: "GROWTH_TRAJECTORY",
      statementIfNew: `Growth trajectory: ${ga.trajectory}. ${ga.summary}`,
      confidence: ga.confidence,
      agentId: params.growthAnalystAgentId,
      evidenceText: ga.summary,
      evidenceSource: "growth-analyst",
    });

    const incidents = await incidentService.listForProduct(product.id);
    const unresolvedIncidents = incidents.filter((i) => i.status !== "RESOLVED" && i.status !== "POSTMORTEM");

    const productHealth = piSummary.activationRate ?? (piSummary.activationSampleInsufficient ? 0.3 : 0);
    const customerHealth = clamp01((ci.segmentIsStrong ? 0.7 : 0.4) - ci.recurringPain.length * 0.05);
    const revenueHealth = clamp01(raSummary.mrr > 0 ? (ra.marginIsSustainable ? 0.7 : 0.5) : 0.2);
    const growthHealth = ga.trajectory === "GROWING" ? 0.7 : ga.trajectory === "FLAT" ? 0.5 : 0.2;
    const marginHealth = clamp01((raSummary.grossMarginPct ?? -0.5) + 0.5);
    const operationalHealth = clamp01(1 - unresolvedIncidents.length * 0.2);
    const evidenceConfidence = clamp01((pi.confidence + ra.confidence + ga.confidence + ci.confidence) / 4);
    const risk = clamp01(1 - (productHealth + customerHealth + revenueHealth + growthHealth + marginHealth) / 5);

    const dimensions: BusinessHealthDimensions = { productHealth, customerHealth, revenueHealth, growthHealth, marginHealth, operationalHealth, risk, evidenceConfidence };

    const priorHealth = await businessHealthRepository.findLatestForProduct(product.id);
    const healthResult = deriveBusinessHealth(dimensions);
    const businessHealth = await businessHealthRepository.create({
      productId: product.id,
      productHealth: dimensions.productHealth,
      customerHealth: dimensions.customerHealth,
      revenueHealth: dimensions.revenueHealth,
      growthHealth: dimensions.growthHealth,
      marginHealth: dimensions.marginHealth,
      operationalHealth: dimensions.operationalHealth,
      risk: dimensions.risk,
      evidenceConfidence: dimensions.evidenceConfidence,
      compositeScore: healthResult.compositeScore,
      state: healthResult.state,
      reasons: toJsonString(healthResult.reasons),
    });

    // docs/M9_ARCHITECTURE_PROPOSAL.md §35 — BusinessHealth.state TRANSITIONING to CRITICAL/DECLINING between two
    // consecutive computations, not merely "is currently" CRITICAL/DECLINING (that would re-alert every single run).
    const declinedInto = (healthResult.state === "CRITICAL" || healthResult.state === "DECLINING") && priorHealth?.state !== healthResult.state;
    if (declinedInto) {
      await alertService.raise({
        alertType: "BUSINESS_HEALTH_DECLINED",
        severity: healthResult.state === "CRITICAL" ? "CRITICAL" : "WARNING",
        resourceType: "PRODUCT",
        resourceId: product.id,
        message: `BusinessHealth transitioned ${priorHealth ? `from ${priorHealth.state} ` : ""}to ${healthResult.state} (composite score ${healthResult.compositeScore.toFixed(2)}).`,
      });
    }

    const ceoOutcome = await ceoReasoningService.recommendBusinessAction({ agentId: params.ceoAgentId, productId: product.id, startedBy: params.startedBy });
    if (ceoOutcome.status !== "COMPLETED") return fail("CEO business-action recommendation did not complete.");
    const ceoRecommendation = ceoOutcome.result.recommendation;

    const { review: chairmanReview } = await chairmanService.reviewBusinessAction({ productId: product.id, reviewedBy: params.startedBy });

    const memo = await businessReviewMemoService.compile({ productId: product.id, businessHealth, ceoRecommendation, chairmanReview, actor });

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "BUSINESS_INTELLIGENCE_ANALYSIS_COMPLETED",
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: "SUCCESS",
      metadata: { businessHealthId: businessHealth.id, ceoAction: ceoRecommendation.action, chairmanDecision: chairmanReview.decision, memoId: memo.id },
    });

    return { product, businessHealth, ceoRecommendation, chairmanReview, memo, stoppedReason: null };
  },
};

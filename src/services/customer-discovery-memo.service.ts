import type { Claim, CustomerDiscoveryMemo } from "@prisma/client";
import { ceoRecommendationRepository } from "../db/repositories/ceo-recommendation.repository.js";
import { chairmanReviewRepository } from "../db/repositories/chairman-review.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { customerDiscoveryMemoRepository } from "../db/repositories/customer-discovery-memo.repository.js";
import { customerResponseRepository } from "../db/repositories/customer-response.repository.js";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { outreachExperimentRepository } from "../db/repositories/outreach-experiment.repository.js";
import { outreachMessageRepository } from "../db/repositories/outreach-message.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { isCustomerDiscoveryHumanDecision } from "../domain/customer-discovery-memo/customer-discovery-memo.types.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { auditService } from "./audit.service.js";
import { customerEvidenceService } from "./customer-evidence.service.js";
import { eventBus } from "./event-bus.js";

export interface CompileCustomerDiscoveryMemoParams {
  experimentId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  actorType: ActorType;
  actorId: string | null;
}

export interface RecordCustomerDiscoveryDecisionParams {
  memoId: string;
  decision: string;
  reason: string | null;
  actor: Actor;
}

/** The brief's own literal field list (Part 29), stored as one JSON blob — mirrors InvestmentMemoContent's own shape. */
export interface CustomerDiscoveryMemoContent {
  opportunity: { id: string; title: string };
  icp: { role: string; industry: string; problemExposure: string } | null;
  experiment: { id: string; objective: string; researchQuestion: string; successCriteria: string; failureCriteria: string };
  prospectsContacted: number;
  responses: Array<{ classification: string | null; rawContent: string }>;
  independentOrganizations: number;
  problemEvidence: string[];
  wtpEvidence: string[];
  urgencyEvidence: string[];
  negativeEvidence: string[];
  majorObjections: string[];
  claimsStrengthened: Array<{ claimId: string; claimType: string; statement: string }>;
  claimsWeakened: Array<{ claimId: string; claimType: string; statement: string }>;
  remainingUncertainty: string[];
  ceo: { action: string; reasoning: string; confidence: number };
  chairman: { decision: string; reasoning: string; objections: string[]; confidence: number };
  human: "PENDING";
}

export interface CustomerDiscoveryMemoResult {
  memo: CustomerDiscoveryMemo;
  content: CustomerDiscoveryMemoContent;
}

/**
 * Customer Discovery Memo compilation (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §22, brief §29) — the milestone's literal final product for one
 * experiment, mirroring investmentMemoService.compile's own discipline
 * exactly: compiled with ZERO new model calls, every field
 * deterministically pulled from data that already exists once a
 * customer-discovery CEO recommendation and Chairman review both exist
 * for the same opportunity.
 */
export const customerDiscoveryMemoService = {
  async compile(params: CompileCustomerDiscoveryMemoParams): Promise<CustomerDiscoveryMemoResult> {
    const experiment = await outreachExperimentRepository.findById(params.experimentId);
    if (!experiment) throw new NotFoundError("OutreachExperiment", params.experimentId);

    const ceoRecommendation = await ceoRecommendationRepository.findById(params.ceoRecommendationId);
    if (!ceoRecommendation || ceoRecommendation.opportunityId !== experiment.opportunityId) {
      throw new ValidationError(`CeoRecommendation ${params.ceoRecommendationId} does not belong to opportunity ${experiment.opportunityId}.`);
    }
    const chairmanReview = await chairmanReviewRepository.findById(params.chairmanReviewId);
    if (!chairmanReview || chairmanReview.opportunityId !== experiment.opportunityId) {
      throw new ValidationError(`ChairmanReview ${params.chairmanReviewId} does not belong to opportunity ${experiment.opportunityId}.`);
    }

    const opp = await opportunityRepository.findById(experiment.opportunityId);
    if (!opp) throw new NotFoundError("Opportunity", experiment.opportunityId);

    const icpProfile = await icpProfileRepository.findById(experiment.targetIcpProfileId);
    const messages = await outreachMessageRepository.listForExperiment(experiment.id);
    const contactedMessages = messages.filter((m) => m.status === "CONTACTED");
    const responses = await customerResponseRepository.listForExperiment(experiment.id);
    const opportunityEvidence = await opportunityRepository.listEvidence(experiment.opportunityId);
    const evidenceById = new Map(opportunityEvidence.map((e) => [e.id, e] as const));

    const distinctProspectIds = Array.from(new Set(responses.map((r) => r.prospectId)));
    const prospects = await Promise.all(distinctProspectIds.map((id) => prospectRepository.findById(id)));
    const knownProspects = prospects.filter((p): p is NonNullable<typeof p> => p !== null);
    const independentOrganizations = new Set(knownProspects.map((p) => p.organization)).size;

    // Every prospect actually contacted under this experiment (not just those who responded) — an honest "who did we talk to."
    const contactedProspectIds = Array.from(new Set(contactedMessages.map((m) => m.prospectId)));
    const contactedProspects = await Promise.all(contactedProspectIds.map((id) => prospectRepository.findById(id)));
    const remainingUncertainty = Array.from(
      new Set(
        contactedProspects
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .flatMap((p) => fromJsonString<string[]>(p.unknowns, [])),
      ),
    );

    const customerEvidenceRecords = await customerEvidenceService.listForOpportunity(experiment.opportunityId);
    const relevantCustomerEvidence = customerEvidenceRecords.filter((ce) => distinctProspectIds.includes(ce.prospectId));
    const evidenceTextBySignal = (signalTypes: readonly string[]): string[] =>
      relevantCustomerEvidence
        .filter((ce) => signalTypes.includes(ce.signalType))
        .map((ce) => evidenceById.get(ce.evidenceId)?.claim)
        .filter((t): t is string => t !== undefined);
    const problemEvidence = evidenceTextBySignal(["PAIN", "FREQUENCY"]);
    const wtpEvidence = evidenceTextBySignal(["WTP", "CURRENT_SPENDING"]);
    const urgencyEvidence = evidenceTextBySignal(["URGENCY"]);
    const negativeEvidence = evidenceTextBySignal(["OBJECTION"]);
    const majorObjections = negativeEvidence;

    // Claims strengthened/weakened (§23-24): among claims this experiment could plausibly have moved
    // (the tested claim, plus any claim an OBJECTION was routed to), a claim counts as strengthened when
    // its CURRENT verdict is SUPPORTED and customer-derived evidence is part of what supports it; weakened
    // when its CURRENT verdict is CONTRADICTED/WEAK/CONFLICTED and customer-derived evidence contradicts it.
    const relatedClaimTypeIds = relevantCustomerEvidence.map((ce) => ce.relatedClaimType).filter((t): t is string => t !== null);
    const candidateClaims = await claimRepository.listForOpportunity(experiment.opportunityId);
    const testedClaim = candidateClaims.find((c) => c.id === experiment.claimId);
    const objectionClaims = candidateClaims.filter((c) => relatedClaimTypeIds.includes(c.claimType));
    const claimsToCheck = new Map<string, Claim>();
    if (testedClaim) claimsToCheck.set(testedClaim.id, testedClaim);
    for (const c of objectionClaims) claimsToCheck.set(c.id, c);

    const customerEvidenceIds = new Set(relevantCustomerEvidence.map((ce) => ce.evidenceId));
    const claimsStrengthened: CustomerDiscoveryMemoContent["claimsStrengthened"] = [];
    const claimsWeakened: CustomerDiscoveryMemoContent["claimsWeakened"] = [];
    for (const claim of claimsToCheck.values()) {
      const report = await validationReportRepository.findLatestForClaim(claim.id);
      if (!report) continue;
      const supportingIds = fromJsonString<string[]>(report.supportingEvidenceIds, []);
      const contradictingIds = fromJsonString<string[]>(report.contradictingEvidenceIds, []);
      const customerSupported = supportingIds.some((id) => customerEvidenceIds.has(id));
      const customerContradicted = contradictingIds.some((id) => customerEvidenceIds.has(id));
      if (claim.status === "SUPPORTED" && customerSupported) {
        claimsStrengthened.push({ claimId: claim.id, claimType: claim.claimType, statement: claim.statement });
      }
      if ((claim.status === "CONTRADICTED" || claim.status === "WEAK" || claim.status === "CONFLICTED") && customerContradicted) {
        claimsWeakened.push({ claimId: claim.id, claimType: claim.claimType, statement: claim.statement });
      }
    }

    const content: CustomerDiscoveryMemoContent = {
      opportunity: { id: opp.id, title: opp.title },
      icp: icpProfile ? { role: icpProfile.role, industry: icpProfile.industry, problemExposure: icpProfile.problemExposure } : null,
      experiment: { id: experiment.id, objective: experiment.objective, researchQuestion: experiment.researchQuestion, successCriteria: experiment.successCriteria, failureCriteria: experiment.failureCriteria },
      prospectsContacted: contactedProspectIds.length,
      responses: responses.map((r) => ({ classification: r.classification, rawContent: r.rawContent })),
      independentOrganizations,
      problemEvidence,
      wtpEvidence,
      urgencyEvidence,
      negativeEvidence,
      majorObjections,
      claimsStrengthened,
      claimsWeakened,
      remainingUncertainty,
      ceo: { action: ceoRecommendation.action, reasoning: ceoRecommendation.reasoning, confidence: ceoRecommendation.confidence },
      chairman: { decision: chairmanReview.decision, reasoning: chairmanReview.reasoning, objections: fromJsonString<string[]>(chairmanReview.objections, []), confidence: chairmanReview.confidence },
      human: "PENDING",
    };

    const memo = await customerDiscoveryMemoRepository.create({
      opportunityId: experiment.opportunityId,
      experimentId: experiment.id,
      ceoRecommendationId: ceoRecommendation.id,
      chairmanReviewId: chairmanReview.id,
      content: toJsonString(content),
      claimsStrengthened: toJsonString(claimsStrengthened.map((c) => c.claimId)),
      claimsWeakened: toJsonString(claimsWeakened.map((c) => c.claimId)),
      independentOrganizationCount: independentOrganizations,
      responseCount: responses.length,
      recommendation: `${ceoRecommendation.action} (Chairman: ${chairmanReview.decision})`,
      confidence: ceoRecommendation.confidence,
    });

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: "CREATE_CUSTOMER_DISCOVERY_MEMO",
      resourceType: "OUTREACH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { memoId: memo.id, opportunityId: experiment.opportunityId },
    });
    await eventBus.publish({
      type: "CUSTOMER_DISCOVERY_MEMO_CREATED",
      payload: { memoId: memo.id, opportunityId: experiment.opportunityId, experimentId: experiment.id, recommendation: memo.recommendation },
    });

    return { memo, content };
  },

  async recordHumanDecision(params: RecordCustomerDiscoveryDecisionParams): Promise<CustomerDiscoveryMemo> {
    assertHumanActor(params.actor);
    if (!isCustomerDiscoveryHumanDecision(params.decision)) {
      throw new ValidationError(`Unknown customer-discovery human decision: ${params.decision}`);
    }
    const memo = await customerDiscoveryMemoService.getOrThrow(params.memoId);
    if (memo.humanDecision !== null) return memo; // Idempotent — already decided.

    const updated = await customerDiscoveryMemoRepository.recordHumanDecision(params.memoId, {
      humanDecision: params.decision,
      humanReason: params.reason,
      decidedByIdentityId: params.actor.actorId ?? "unknown",
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `CUSTOMER_DISCOVERY_MEMO_DECISION_${params.decision}`,
      resourceType: "CUSTOMER_DISCOVERY_MEMO",
      resourceId: params.memoId,
      result: "SUCCESS",
      metadata: { reason: params.reason },
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — the one cross-milestone event decisionQueueService's own unification (§19) makes real at the event layer.
    await eventBus.publish({ type: "HUMAN_DECISION_MADE", payload: { source: "CUSTOMER_DISCOVERY_MEMO", memoId: updated.id, decision: params.decision } });
    if (params.decision === "APPROVE") {
      await eventBus.publish({ type: "CUSTOMER_VALIDATED", payload: { memoId: updated.id, opportunityId: updated.opportunityId, experimentId: updated.experimentId } });
    }

    return updated;
  },

  listForOpportunity: customerDiscoveryMemoRepository.listForOpportunity,
  findLatestForExperiment: customerDiscoveryMemoRepository.findLatestForExperiment,

  async getOrThrow(id: string): Promise<CustomerDiscoveryMemo> {
    const memo = await customerDiscoveryMemoRepository.findById(id);
    if (!memo) throw new NotFoundError("CustomerDiscoveryMemo", id);
    return memo;
  },
};

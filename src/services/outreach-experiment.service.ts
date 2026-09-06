import type { OutreachExperiment } from "@prisma/client";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { customerEvidenceRepository } from "../db/repositories/customer-evidence.repository.js";
import { customerResponseRepository } from "../db/repositories/customer-response.repository.js";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { outreachExperimentRepository, type CreateOutreachExperimentInput } from "../db/repositories/outreach-experiment.repository.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { classifyExperimentDiscoveryOutcome, type ExperimentDiscoveryOutcome, type ResponseForOutcome } from "../domain/customer-response/experiment-outcome.js";
import { DEFAULT_OUTREACH_LIMITS } from "../domain/outreach-experiment/outreach-limits.js";
import { isContactPolicy, DEFAULT_CONTACT_POLICY } from "../domain/prospect/contact-policy.js";
import { isOutreachExperimentStatus, OUTREACH_EXPERIMENT_STATUS_TRANSITIONS } from "../domain/outreach-experiment/outreach-experiment.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateOutreachExperimentParams extends Omit<CreateOutreachExperimentInput, "contactPolicy"> {
  /** Defaults to DEFAULT_CONTACT_POLICY (HUMAN_APPROVAL_REQUIRED) when omitted — APPROVED is never a creation default (§9). */
  contactPolicy?: string;
}

export interface ApproveOutreachExperimentParams {
  id: string;
  actor: Actor;
}

export interface SetOutreachExperimentStatusParams {
  id: string;
  toStatus: string;
  reason: string | null;
  actorType: Actor["actorType"];
  actorId: string | null;
}

export interface DiscoveryOutcomeAssessment {
  readonly experimentId: string;
  readonly outcome: ExperimentDiscoveryOutcome;
  readonly totalResponses: number;
  readonly analyzedResponses: number;
  readonly reasoning: string;
}

/**
 * The first hard human gate in the M5 core loop (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §2, §11): an OutreachExperiment is created PENDING_APPROVAL; no
 * Prospect may enter APPROVED_FOR_DRAFT and no OutreachMessage may be
 * drafted under an experiment that isn't ACTIVE. `approve` requires a
 * verified HUMAN actor — the same `assertHumanActor` defense-in-depth
 * `decisionRecordService.applyHumanDecision` already uses — and is a
 * simple, direct state transition (no full ApprovalRequest object):
 * no agent is "proposing" this for Chairman-style adversarial scrutiny,
 * a human is directly deciding whether to open a targeting decision
 * for drafting at all.
 */
export const outreachExperimentService = {
  async create(params: CreateOutreachExperimentParams): Promise<OutreachExperiment> {
    const claim = await claimRepository.findById(params.claimId);
    if (!claim) throw new NotFoundError("Claim", params.claimId);
    if (claim.opportunityId !== params.opportunityId) {
      throw new ValidationError(`Claim ${claim.id} belongs to a different opportunity than this experiment.`);
    }
    const icpProfile = await icpProfileRepository.findById(params.targetIcpProfileId);
    if (!icpProfile) throw new NotFoundError("IcpProfile", params.targetIcpProfileId);
    if (icpProfile.opportunityId !== params.opportunityId) {
      throw new ValidationError(`IcpProfile ${icpProfile.id} belongs to a different opportunity than this experiment.`);
    }
    if (params.prospectLimit > DEFAULT_OUTREACH_LIMITS.maxProspectsPerExperiment) {
      throw new ValidationError(`prospectLimit ${params.prospectLimit} exceeds the maximum of ${DEFAULT_OUTREACH_LIMITS.maxProspectsPerExperiment} per experiment.`);
    }
    const contactPolicy = params.contactPolicy ?? DEFAULT_CONTACT_POLICY;
    if (!isContactPolicy(contactPolicy)) {
      throw new ValidationError(`Unknown contact policy: ${contactPolicy}`);
    }

    const experiment = await outreachExperimentRepository.create({ ...params, contactPolicy });

    await auditService.record({
      actorType: "SYSTEM",
      actorId: params.createdByIdentityId,
      action: "CREATE_OUTREACH_EXPERIMENT",
      resourceType: "OUTREACH_EXPERIMENT",
      resourceId: experiment.id,
      result: "SUCCESS",
      metadata: { opportunityId: experiment.opportunityId, claimId: experiment.claimId, contactPolicy },
    });

    return experiment;
  },

  async getOrThrow(id: string): Promise<OutreachExperiment> {
    const experiment = await outreachExperimentRepository.findById(id);
    if (!experiment) throw new NotFoundError("OutreachExperiment", id);
    return experiment;
  },

  listForOpportunity: outreachExperimentRepository.listForOpportunity,

  /**
   * Human-Owner-only. Refuses to open a new experiment for drafting
   * once the opportunity already has DEFAULT_OUTREACH_LIMITS.maxActiveExperimentsPerOpportunity
   * ACTIVE experiments — never an unbounded number of simultaneous
   * discovery efforts (§26).
   */
  async approve(params: ApproveOutreachExperimentParams): Promise<OutreachExperiment> {
    assertHumanActor(params.actor);

    const experiment = await outreachExperimentService.getOrThrow(params.id);
    if (!isOutreachExperimentStatus(experiment.status)) {
      throw new ValidationError(`Corrupt stored status on outreach experiment ${experiment.id}: ${experiment.status}`);
    }
    assertTransition("OutreachExperiment", OUTREACH_EXPERIMENT_STATUS_TRANSITIONS, experiment.status, "ACTIVE");

    const activeCount = await outreachExperimentRepository.countActiveForOpportunity(experiment.opportunityId);
    if (activeCount >= DEFAULT_OUTREACH_LIMITS.maxActiveExperimentsPerOpportunity) {
      throw new ValidationError(
        `Opportunity ${experiment.opportunityId} already has ${activeCount} ACTIVE outreach experiment(s) — the limit is ${DEFAULT_OUTREACH_LIMITS.maxActiveExperimentsPerOpportunity}.`,
      );
    }

    const approved = await outreachExperimentRepository.approve(params.id, params.actor.actorId ?? "unknown", new Date());

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "APPROVE_OUTREACH_EXPERIMENT",
      resourceType: "OUTREACH_EXPERIMENT",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: { opportunityId: experiment.opportunityId },
    });
    await eventBus.publish({
      type: "OUTREACH_EXPERIMENT_APPROVED",
      payload: { experimentId: approved.id, opportunityId: approved.opportunityId, approvedByIdentityId: approved.approvedByIdentityId },
    });

    return approved;
  },

  async setStatus(params: SetOutreachExperimentStatusParams): Promise<OutreachExperiment> {
    if (!isOutreachExperimentStatus(params.toStatus)) {
      throw new ValidationError(`Unknown outreach experiment status: ${params.toStatus}`);
    }
    const experiment = await outreachExperimentService.getOrThrow(params.id);
    if (!isOutreachExperimentStatus(experiment.status)) {
      throw new ValidationError(`Corrupt stored status on outreach experiment ${experiment.id}: ${experiment.status}`);
    }
    assertTransition("OutreachExperiment", OUTREACH_EXPERIMENT_STATUS_TRANSITIONS, experiment.status, params.toStatus);

    const updated = await outreachExperimentRepository.updateStatus(params.id, params.toStatus);

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: `OUTREACH_EXPERIMENT_STATUS_${experiment.status}_TO_${params.toStatus}`,
      resourceType: "OUTREACH_EXPERIMENT",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: { reason: params.reason },
    });

    return updated;
  },

  /**
   * Read-only (Design Requirement G). Replaces the naive "silence
   * after N contacted = failure" reading of `failureCriteria` with an
   * honest classification reusing only data the existing M5 pipeline
   * already records — no new response system. NO_RESPONSE is reported
   * as its own outcome, distinct from PROBLEM_NOT_PRESENT: silence is
   * a distribution/outreach signal, never itself evidence the
   * underlying problem is false.
   */
  async evaluateDiscoveryOutcome(experimentId: string): Promise<DiscoveryOutcomeAssessment> {
    await outreachExperimentService.getOrThrow(experimentId);
    const responses = await customerResponseRepository.listForExperiment(experimentId);

    const responsesForOutcome: ResponseForOutcome[] = await Promise.all(
      responses.map(async (r) => {
        const evidence = await customerEvidenceRepository.listForResponse(r.id);
        return { status: r.status, classification: r.classification, signalTypes: evidence.map((e) => e.signalType) };
      }),
    );

    const outcome = classifyExperimentDiscoveryOutcome(responsesForOutcome);
    const analyzedResponses = responsesForOutcome.filter((r) => r.status === "ANALYZED").length;

    const reasoning =
      outcome === "NO_RESPONSE"
        ? `${responses.length} response(s) recorded, none analyzed yet — no data to classify. This is a distribution/outreach signal, not evidence the underlying problem is false.`
        : `${analyzedResponses} analyzed response(s) considered; classified ${outcome} from their recorded classification/signal types.`;

    return { experimentId, outcome, totalResponses: responses.length, analyzedResponses, reasoning };
  },
};

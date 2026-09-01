import type { Evidence } from "@prisma/client";
import { evidenceRepository } from "../db/repositories/evidence.repository.js";
import {
  EVIDENCE_VERIFICATION_TRANSITIONS,
  isEvidenceReliability,
  isEvidenceSourceType,
  isEvidenceVerificationStatus,
} from "../domain/evidence/evidence.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { agentService, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CollectEvidenceParams {
  claim: string;
  source: string;
  sourceType: string;
  sourceReference?: string | null;
  collectedByAgentId: string;
  reliability: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  /** M3 — set when this Evidence is promoted from a Signal
   *  (docs/M3_ARCHITECTURE_PROPOSAL.md §8); null for M1/M2 direct
   *  collection. A real FK column, not metadata, so
   *  evidenceRepository.findBySignalId() (idempotent promotion) works. */
  signalId?: string | null;
}

function assertConfidence(confidence: number): void {
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new ValidationError(`confidence must be between 0 and 1 (got ${confidence})`);
  }
}

export const evidenceService = {
  /**
   * An agent's conclusion is NOT automatically evidence (Constitution
   * §9 of the M1 brief). This is the only way an Evidence row is
   * created — there is no path that lets a claim become "evidence"
   * without going through here, with an explicit source, reliability,
   * and collector.
   */
  async collectEvidence(params: CollectEvidenceParams): Promise<Evidence> {
    if (!isEvidenceSourceType(params.sourceType)) {
      throw new ValidationError(`Unknown source type: ${params.sourceType}`);
    }
    if (!isEvidenceReliability(params.reliability)) {
      throw new ValidationError(`Unknown reliability: ${params.reliability}`);
    }
    assertConfidence(params.confidence);
    await agentService.getAgentOrThrow(params.collectedByAgentId);

    const evidence = await evidenceRepository.create({
      claim: params.claim,
      source: params.source,
      sourceType: params.sourceType,
      sourceReference: params.sourceReference ?? null,
      collectedByAgentId: params.collectedByAgentId,
      reliability: params.reliability,
      confidence: params.confidence,
      metadata: params.metadata ? toJsonString(params.metadata) : null,
      signalId: params.signalId ?? null,
    });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.collectedByAgentId,
      action: "COLLECT_EVIDENCE",
      resourceType: "EVIDENCE",
      resourceId: evidence.id,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "EVIDENCE_ADDED", payload: { evidenceId: evidence.id, sourceType: evidence.sourceType } });

    return evidence;
  },

  async getOrThrow(id: string): Promise<Evidence> {
    const evidence = await evidenceRepository.findById(id);
    if (!evidence) throw new NotFoundError("Evidence", id);
    return evidence;
  },

  listEvidence: evidenceRepository.list,

  async setVerificationStatus(params: { id: string; verificationStatus: string; actor: Actor }): Promise<Evidence> {
    if (!isEvidenceVerificationStatus(params.verificationStatus)) {
      throw new ValidationError(`Unknown verification status: ${params.verificationStatus}`);
    }
    const evidence = await evidenceService.getOrThrow(params.id);
    if (!isEvidenceVerificationStatus(evidence.verificationStatus)) {
      throw new ValidationError(`Corrupt stored verification status on evidence ${evidence.id}: ${evidence.verificationStatus}`);
    }
    assertTransition(
      "Evidence.verificationStatus",
      EVIDENCE_VERIFICATION_TRANSITIONS,
      evidence.verificationStatus,
      params.verificationStatus,
    );

    const updated = await evidenceRepository.updateVerificationStatus(params.id, params.verificationStatus);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `EVIDENCE_VERIFICATION_${evidence.verificationStatus}_TO_${params.verificationStatus}`,
      resourceType: "EVIDENCE",
      resourceId: params.id,
      result: "SUCCESS",
    });

    return updated;
  },
};

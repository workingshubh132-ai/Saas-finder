import type { CustomerDiscoveryInteraction, CustomerEvidence, DiscoveryFinding, Evidence } from "@prisma/client";
import { customerDiscoveryInteractionRepository } from "../db/repositories/customer-discovery-interaction.repository.js";
import { discoveryFindingRepository } from "../db/repositories/discovery-finding.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import {
  isCustomerDiscoveryInteractionOutcome,
  isCustomerDiscoveryInteractionType,
  isDiscoveryFindingField,
} from "../domain/customer-discovery/discovery-interaction.types.js";
import { signalTypeForFindingField } from "../domain/customer-discovery/finding-signal-mapping.js";
import { isFindingProvenance } from "../domain/customer-discovery/provenance.js";
import { isCustomerEvidenceStrength } from "../domain/customer-evidence/customer-signal.types.js";
import { buildRealWorldTag, isRealityLabel } from "../domain/real-world/reality.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertHumanActor, type Actor } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { customerEvidenceService } from "./customer-evidence.service.js";
import { evidenceService } from "./evidence.service.js";
import { eventBus } from "./event-bus.js";
import { opportunityService } from "./opportunity.service.js";
import { prospectService } from "./prospect.service.js";

export interface RecordInteractionParams {
  opportunityId: string;
  prospectId: string;
  outreachMessageId?: string | null;
  interactionType: string;
  interactionDate: Date;
  channel?: string | null;
  participantRole?: string | null;
  rawNotes: string;
  reality: string;
  provenanceNote: string;
  actor: Actor;
}

export interface AttachFindingParams {
  interactionId: string;
  field: string;
  provenance: string;
  value: string;
  evidenceQuote?: string | null;
  /** Required only when the finding is promotable (OBSERVED + a mapped signal type) — see attachFinding's own doc comment. */
  strength?: string;
  agentId: string;
}

export interface AttachFindingResult {
  finding: DiscoveryFinding;
  evidence: Evidence | null;
  customerEvidence: CustomerEvidence | null;
}

export interface SetOutcomeParams {
  interactionId: string;
  outcome: string;
  actor: Actor;
}

/**
 * The Customer Discovery + Validation layer's own interaction-recording
 * boundary (docs/CUSTOMER_DISCOVERY_VALIDATION.md, Phases 2-3). Mirrors
 * customerResponseService.record()'s own discipline (human-only, since
 * this is manually transcribed from a real external channel VentureForge
 * has no programmatic access to) but does not require a prior
 * OutreachMessage this system itself sent — an interview, a call, or a
 * reply to a message sent outside the governed outbound path all have
 * no such message to point to.
 */
export const customerDiscoveryInteractionService = {
  async record(params: RecordInteractionParams): Promise<CustomerDiscoveryInteraction> {
    assertHumanActor(params.actor);

    if (!isCustomerDiscoveryInteractionType(params.interactionType)) {
      throw new ValidationError(`Unknown interaction type: ${params.interactionType}`);
    }
    if (!isRealityLabel(params.reality)) {
      throw new ValidationError(`Unknown reality label: ${params.reality}`);
    }
    if (params.rawNotes.trim().length === 0) {
      throw new ValidationError("rawNotes must not be empty.");
    }
    // Reused purely for its validation (throws on an empty note for REAL/HUMAN_ACTION) — reality/provenanceNote are
    // stored as plain columns here, not embedded as a metadata tag, since this model always carries them directly.
    buildRealWorldTag({ reality: params.reality, experimentId: null, note: params.provenanceNote });

    const opportunity = await opportunityService.getOrThrow(params.opportunityId);
    const prospect = await prospectService.getOrThrow(params.prospectId);
    if (prospect.opportunityId !== opportunity.id) {
      throw new ValidationError(`Prospect ${prospect.id} belongs to a different opportunity than ${opportunity.id}.`);
    }

    const interaction = await customerDiscoveryInteractionRepository.create({
      opportunityId: opportunity.id,
      prospectId: prospect.id,
      outreachMessageId: params.outreachMessageId ?? null,
      interactionType: params.interactionType,
      interactionDate: params.interactionDate,
      channel: params.channel ?? null,
      participantRole: params.participantRole ?? null,
      rawNotes: params.rawNotes,
      reality: params.reality,
      provenanceNote: params.provenanceNote,
      recordedByIdentityId: params.actor.actorId ?? "unknown",
    });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "RECORD_DISCOVERY_INTERACTION",
      resourceType: "CUSTOMER_DISCOVERY_INTERACTION",
      resourceId: interaction.id,
      result: "SUCCESS",
      metadata: { opportunityId: opportunity.id, prospectId: prospect.id, interactionType: interaction.interactionType, reality: interaction.reality },
    });
    await eventBus.publish({
      type: "CUSTOMER_DISCOVERY_INTERACTION_RECORDED",
      payload: { interactionId: interaction.id, opportunityId: opportunity.id, prospectId: prospect.id },
    });

    return interaction;
  },

  /**
   * Records one structured finding. Only OBSERVED findings that map to
   * a CustomerSignalType are ever promoted to a real Evidence +
   * CustomerEvidence pair — the concrete mechanism that makes "never
   * let an inferred value masquerade as observed evidence" true by
   * construction: an INFERRED or UNKNOWN finding simply has no code
   * path that turns it into Evidence.
   */
  async attachFinding(params: AttachFindingParams): Promise<AttachFindingResult> {
    if (!isDiscoveryFindingField(params.field)) {
      throw new ValidationError(`Unknown discovery finding field: ${params.field}`);
    }
    if (!isFindingProvenance(params.provenance)) {
      throw new ValidationError(`Unknown finding provenance: ${params.provenance}`);
    }
    if (params.value.trim().length === 0) {
      throw new ValidationError("value must not be empty — even an UNKNOWN finding needs an explanatory note (e.g. \"not asked\"), never a bare omission.");
    }

    const interaction = await customerDiscoveryInteractionRepository.findById(params.interactionId);
    if (!interaction) throw new NotFoundError("CustomerDiscoveryInteraction", params.interactionId);

    const finding = await discoveryFindingRepository.create({
      interactionId: interaction.id,
      field: params.field,
      provenance: params.provenance,
      value: params.value,
      evidenceQuote: params.evidenceQuote ?? null,
    });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.agentId,
      action: "RECORD_DISCOVERY_FINDING",
      resourceType: "DISCOVERY_FINDING",
      resourceId: finding.id,
      result: "SUCCESS",
      metadata: { interactionId: interaction.id, field: params.field, provenance: params.provenance },
    });

    let evidence: Evidence | null = null;
    let customerEvidence: CustomerEvidence | null = null;
    const signalType = params.provenance === "OBSERVED" ? signalTypeForFindingField(params.field) : null;

    if (signalType) {
      const strength = params.strength ?? "MEDIUM";
      if (!isCustomerEvidenceStrength(strength)) {
        throw new ValidationError(`Unknown customer evidence strength: ${strength}`);
      }
      if (!isRealityLabel(interaction.reality)) {
        throw new ValidationError(`Corrupt stored reality label on interaction ${interaction.id}: ${interaction.reality}`);
      }

      evidence = await evidenceService.collectEvidence({
        claim: params.evidenceQuote ?? params.value,
        source: "customer-discovery-interaction",
        sourceType: "CUSTOMER",
        sourceReference: interaction.id,
        collectedByAgentId: params.agentId,
        reliability: strength,
        // OBSERVED is this layer's equivalent of CustomerEvidenceDirectness's own DIRECT — 0.8, matching
        // response-analyst.service.ts's CONFIDENCE_FOR_DIRECTNESS.DIRECT exactly, not a new number invented here.
        confidence: 0.8,
        // Carries the interaction's own REAL/DEV_FIXTURE/HUMAN_ACTION/SIMULATED tag onto the Evidence row
        // (Phase 10) — the exact M10 pattern (Signal.metadata.realWorld), never re-derived or upgraded here.
        metadata: { realWorld: buildRealWorldTag({ reality: interaction.reality, experimentId: null, note: interaction.provenanceNote }) },
      });
      await opportunityRepository.attachEvidence(interaction.opportunityId, evidence.id);

      customerEvidence = await customerEvidenceService.create({
        responseId: null,
        discoveryInteractionId: interaction.id,
        evidenceId: evidence.id,
        prospectId: interaction.prospectId,
        signalType,
        relatedClaimType: null,
        strength,
        directness: "DIRECT",
        extractedByAgentId: params.agentId,
        actorId: params.agentId,
      });

      await discoveryFindingRepository.markPromoted(finding.id, evidence.id);
    }

    return { finding, evidence, customerEvidence };
  },

  async setOutcome(params: SetOutcomeParams): Promise<CustomerDiscoveryInteraction> {
    assertHumanActor(params.actor);
    if (!isCustomerDiscoveryInteractionOutcome(params.outcome)) {
      throw new ValidationError(`Unknown interaction outcome: ${params.outcome}`);
    }
    const interaction = await customerDiscoveryInteractionRepository.findById(params.interactionId);
    if (!interaction) throw new NotFoundError("CustomerDiscoveryInteraction", params.interactionId);

    const updated = await customerDiscoveryInteractionRepository.setOutcome(interaction.id, params.outcome);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "SET_DISCOVERY_INTERACTION_OUTCOME",
      resourceType: "CUSTOMER_DISCOVERY_INTERACTION",
      resourceId: interaction.id,
      result: "SUCCESS",
      metadata: { outcome: params.outcome },
    });

    return updated;
  },

  async getOrThrow(id: string): Promise<CustomerDiscoveryInteraction> {
    const interaction = await customerDiscoveryInteractionRepository.findById(id);
    if (!interaction) throw new NotFoundError("CustomerDiscoveryInteraction", id);
    return interaction;
  },

  listForOpportunity: customerDiscoveryInteractionRepository.listForOpportunity,
  listFindingsForInteraction: discoveryFindingRepository.listForInteraction,
};

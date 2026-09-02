import type { CustomerEvidence } from "@prisma/client";
import { customerEvidenceRepository, type CreateCustomerEvidenceInput } from "../db/repositories/customer-evidence.repository.js";
import { isCustomerEvidenceDirectness, isCustomerEvidenceStrength, isCustomerSignalType } from "../domain/customer-evidence/customer-signal.types.js";
import { isClaimType } from "../domain/claim/claim.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateCustomerEvidenceParams extends CreateCustomerEvidenceInput {
  actorId: string | null;
}

/**
 * Wraps one real M4 Evidence row with the M5-specific structured
 * fields a customer response actually needs (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §16-17). The caller (responseAnalystService) is responsible for
 * having already created the wrapped Evidence row through the
 * unmodified evidenceService.collectEvidence — this service only
 * persists the wrapper, it never creates Evidence itself.
 */
export const customerEvidenceService = {
  async create(params: CreateCustomerEvidenceParams): Promise<CustomerEvidence> {
    if (!isCustomerSignalType(params.signalType)) {
      throw new ValidationError(`Unknown customer signal type: ${params.signalType}`);
    }
    if (params.relatedClaimType !== null && !isClaimType(params.relatedClaimType)) {
      throw new ValidationError(`Unknown related claim type: ${params.relatedClaimType}`);
    }
    if (!isCustomerEvidenceStrength(params.strength)) {
      throw new ValidationError(`Unknown customer evidence strength: ${params.strength}`);
    }
    if (!isCustomerEvidenceDirectness(params.directness)) {
      throw new ValidationError(`Unknown customer evidence directness: ${params.directness}`);
    }

    const { actorId, ...createInput } = params;
    const customerEvidence = await customerEvidenceRepository.create(createInput);

    await auditService.record({
      actorType: "AGENT",
      actorId,
      action: "CREATE_CUSTOMER_EVIDENCE",
      resourceType: "CUSTOMER_EVIDENCE",
      resourceId: customerEvidence.id,
      result: "SUCCESS",
      metadata: { responseId: customerEvidence.responseId, evidenceId: customerEvidence.evidenceId, signalType: customerEvidence.signalType },
    });
    await eventBus.publish({
      type: "CUSTOMER_EVIDENCE_CREATED",
      payload: { customerEvidenceId: customerEvidence.id, evidenceId: customerEvidence.evidenceId, prospectId: customerEvidence.prospectId, signalType: customerEvidence.signalType },
    });

    return customerEvidence;
  },

  findByEvidenceId: customerEvidenceRepository.findByEvidenceId,
  listForOpportunity: customerEvidenceRepository.listForOpportunity,
  listForResponse: customerEvidenceRepository.listForResponse,
};

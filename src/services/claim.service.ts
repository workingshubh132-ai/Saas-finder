import type { Claim } from "@prisma/client";
import { claimRepository, type CreateClaimInput } from "../db/repositories/claim.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { isClaimImportance, isClaimType } from "../domain/claim/claim.types.js";
import { CLAIM_VALIDATION_TRANSITIONS, isClaimValidationStatus } from "../domain/claim/claim-validation.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateClaimParams extends CreateClaimInput {
  actorType: ActorType;
  actorId: string | null;
}

export interface SetClaimStatusParams {
  id: string;
  toStatus: string;
  /** The freshly recalculated confidence to persist alongside the new status (docs/M4_ARCHITECTURE_PROPOSAL.md §11) — never set independently of a status change. */
  confidence: number;
  actorType: ActorType;
  actorId: string | null;
}

/**
 * Claim CRUD + the one state-machine transition point
 * (docs/M4_ARCHITECTURE_PROPOSAL.md §3, §5) — mirrors
 * `problem.service.ts`'s shape exactly. Claim creation itself is
 * always deterministic (`claim-extraction.service.ts` is the only
 * caller of `create` in practice); this service does not decide *what*
 * a claim says, only persists and audits it.
 */
export const claimService = {
  async create(params: CreateClaimParams): Promise<Claim> {
    if (!isClaimType(params.claimType)) {
      throw new ValidationError(`Unknown claim type: ${params.claimType}`);
    }
    if (!isClaimImportance(params.importance)) {
      throw new ValidationError(`Unknown claim importance: ${params.importance}`);
    }
    const { actorType, actorId, ...createInput } = params;
    const claim = await claimRepository.create(createInput);

    await auditService.record({
      actorType,
      actorId,
      action: "CLAIM_EXTRACTED",
      resourceType: "CLAIM",
      resourceId: claim.id,
      result: "SUCCESS",
      metadata: { opportunityId: claim.opportunityId, claimType: claim.claimType, importance: claim.importance },
    });
    await eventBus.publish({
      type: "CLAIM_EXTRACTED",
      payload: { claimId: claim.id, opportunityId: claim.opportunityId, claimType: claim.claimType, importance: claim.importance },
    });

    return claim;
  },

  async getOrThrow(id: string): Promise<Claim> {
    const claim = await claimRepository.findById(id);
    if (!claim) throw new NotFoundError("Claim", id);
    return claim;
  },

  listForOpportunity: claimRepository.listForOpportunity,

  /**
   * The complete-digraph state machine (domain/claim/claim-validation.types.ts)
   * still goes through `assertTransition` for consistency and
   * auditability even though every edge is legal — a corrupt stored
   * value is still rejected.
   */
  async setStatus(params: SetClaimStatusParams): Promise<Claim> {
    if (!isClaimValidationStatus(params.toStatus)) {
      throw new ValidationError(`Unknown claim validation status: ${params.toStatus}`);
    }
    const claim = await claimService.getOrThrow(params.id);
    if (!isClaimValidationStatus(claim.status)) {
      throw new ValidationError(`Corrupt stored status on claim ${claim.id}: ${claim.status}`);
    }
    assertTransition("Claim", CLAIM_VALIDATION_TRANSITIONS, claim.status, params.toStatus);

    const updated = await claimRepository.update(params.id, { status: params.toStatus, confidence: params.confidence });

    await auditService.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: `CLAIM_STATUS_${claim.status}_TO_${params.toStatus}`,
      resourceType: "CLAIM",
      resourceId: params.id,
      result: "SUCCESS",
      metadata: { confidence: params.confidence },
    });
    await eventBus.publish({
      type: "CLAIM_VALIDATED",
      payload: { claimId: params.id, opportunityId: claim.opportunityId, status: params.toStatus, confidence: params.confidence },
    });

    return updated;
  },
};

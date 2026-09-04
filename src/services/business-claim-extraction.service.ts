import type { Claim } from "@prisma/client";
import { claimEvidenceRepository } from "../db/repositories/claim-evidence.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { evidenceRepository } from "../db/repositories/evidence.repository.js";
import { CLAIM_TYPE_IMPORTANCE, type ClaimType } from "../domain/claim/claim.types.js";
import type { ClaimValidationStatus } from "../domain/claim/claim-validation.types.js";
import { claimService } from "./claim.service.js";

export interface UpsertBusinessClaimParams {
  opportunityId: string;
  claimType: ClaimType;
  /** Used only if no claim of this type exists yet — an existing claim's own original statement is never rewritten (claimRepository.update only ever touches status/confidence, matching M4's own established discipline: the ORIGINAL assertion stays fixed; what changes is the current best read on whether it holds). */
  statementIfNew: string;
  confidence: number;
  agentId: string;
  evidenceText: string;
  evidenceSource: string;
}

function deriveStatus(confidence: number): ClaimValidationStatus {
  if (confidence >= 0.6) return "SUPPORTED";
  if (confidence >= 0.4) return "WEAK";
  return "INSUFFICIENT_EVIDENCE";
}

function reliabilityFor(confidence: number): string {
  if (confidence >= 0.6) return "HIGH";
  if (confidence >= 0.4) return "MEDIUM";
  return "LOW";
}

/**
 * Extends M4's existing Claim architecture (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §21) — no duplicate claim system. Every M8 business claim attaches
 * to `claim.opportunityId`, the product's own originating Opportunity
 * (Product.opportunityId is @unique — a 1:1 relation, so this needs no
 * new foreign key at all). A real Evidence row and a real ClaimEvidence
 * link are always created, even when the underlying Claim row already
 * existed from pre-launch extraction — this is what makes the
 * SOURCE -> EVIDENCE -> CLAIM chain (§39) real rather than aspirational.
 */
export const businessClaimExtractionService = {
  async upsertClaim(params: UpsertBusinessClaimParams): Promise<Claim> {
    const existingClaims = await claimRepository.listForOpportunity(params.opportunityId);
    const existing = existingClaims.find((c) => c.claimType === params.claimType);
    const status = deriveStatus(params.confidence);

    const evidence = await evidenceRepository.create({
      claim: params.evidenceText,
      source: params.evidenceSource,
      sourceType: "BUSINESS_METRIC",
      sourceReference: null,
      collectedByAgentId: params.agentId,
      reliability: reliabilityFor(params.confidence),
      confidence: params.confidence,
      metadata: null,
    });

    const claim = existing
      ? await claimRepository.update(existing.id, { status, confidence: params.confidence })
      : await claimService.create({
          opportunityId: params.opportunityId,
          claimType: params.claimType,
          statement: params.statementIfNew,
          importance: CLAIM_TYPE_IMPORTANCE[params.claimType],
          confidence: params.confidence,
          extractedFrom: params.evidenceSource,
          actorType: "AGENT",
          actorId: params.agentId,
        });

    await claimEvidenceRepository.create({
      claimId: claim.id,
      evidenceId: evidence.id,
      relationship: "SUPPORTING",
      reasoning: params.evidenceText,
      validationReportId: null,
    });

    return claim;
  },
};

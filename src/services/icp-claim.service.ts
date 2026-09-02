import type { Claim, IcpProfile } from "@prisma/client";
import { claimRepository } from "../db/repositories/claim.repository.js";
import type { ActorType } from "../domain/audit/audit.types.js";
import { CLAIM_TYPE_IMPORTANCE, type ClaimType } from "../domain/claim/claim.types.js";
import type { IcpFieldGrounding } from "../domain/icp-profile/icp-field-grounding.js";
import { fromJsonString } from "../domain/shared/json.js";
import { claimService } from "./claim.service.js";

/** A prior, not a verdict — same value and meaning as claim-extraction.service.ts's own ASSUMPTION_PRIOR_CONFIDENCE: always superseded once a ValidationReport exists. */
const ICP_CLAIM_PRIOR_CONFIDENCE = 0.2;

/**
 * The three ICP fields that map 1:1 onto an existing ClaimType (brief
 * §4, docs/M5_ARCHITECTURE_PROPOSAL.md §4) — the ones customer
 * discovery can actually confirm or deny through a real conversation.
 * industry/geography/technology/companySize/exclusions are targeting
 * *parameters*, not themselves falsifiable customer-behavior claims,
 * so they are deliberately NOT wired here — wiring every field would
 * create claims nobody could meaningfully validate via a customer
 * response.
 */
const ICP_TESTABLE_FIELDS: Readonly<Record<"role" | "problemExposure" | "likelyFrequency", ClaimType>> = {
  role: "CUSTOMER_SEGMENT",
  problemExposure: "CUSTOMER_PROBLEM",
  likelyFrequency: "FREQUENCY",
};

/**
 * Turns an ICP's important, testable assumptions into real, traceable
 * Claim rows (brief §4) — so "M4's validation machinery" (unmodified:
 * evidenceValidatorService, claimConfidenceService) has something
 * concrete to validate once customer discovery produces evidence, and
 * so OutreachExperiment.claimId / the CEO's TEST_CLAIM action can
 * target an ICP-specific assumption, not only the original M4
 * opportunity-level claims. Reuses claimService.create directly — no
 * new claim types, no second extraction pipeline (§4 of the proposal:
 * "ICP claims reuse the existing Claim model directly").
 */
export const icpClaimService = {
  /**
   * Idempotent per icpProfileId (keyed by `extractedFrom`, the exact
   * dedup precedent claim-extraction.service.ts already established)
   * — safe to call once per ICP generation. Skips creating a new claim
   * when the ICP's own field value is already verbatim the same text
   * as the single existing claim it was grounded in: that claim
   * already carries this assertion, so citing it again as a duplicate
   * would add noise, not traceability.
   */
  async wireForIcpProfile(icpProfile: IcpProfile, params: { actorType: ActorType; actorId: string | null }): Promise<Claim[]> {
    const grounding = fromJsonString<IcpFieldGrounding>(icpProfile.fieldGrounding, []);
    const groundingByField = new Map(grounding.map((g) => [g.field, g] as const));
    const existingClaims = await claimRepository.listForOpportunity(icpProfile.opportunityId);
    const existingByExtractedFrom = new Map(existingClaims.filter((c): c is Claim & { extractedFrom: string } => c.extractedFrom !== null).map((c) => [c.extractedFrom, c] as const));

    const wired: Claim[] = [];
    for (const field of Object.keys(ICP_TESTABLE_FIELDS) as Array<keyof typeof ICP_TESTABLE_FIELDS>) {
      const claimType = ICP_TESTABLE_FIELDS[field];
      const extractedFrom = `ICP_PROFILE.${icpProfile.id}.${field}`;

      const already = existingByExtractedFrom.get(extractedFrom);
      if (already) {
        wired.push(already);
        continue;
      }

      const fieldValue = icpProfile[field];
      const fieldGrounding = groundingByField.get(field);
      if (fieldGrounding && fieldGrounding.groundedInClaimIds.length === 1) {
        const citedClaim = existingClaims.find((c) => c.id === fieldGrounding.groundedInClaimIds[0]);
        if (citedClaim && citedClaim.statement === fieldValue) {
          wired.push(citedClaim);
          continue;
        }
      }

      wired.push(
        await claimService.create({
          opportunityId: icpProfile.opportunityId,
          claimType,
          statement: fieldValue,
          importance: CLAIM_TYPE_IMPORTANCE[claimType],
          confidence: ICP_CLAIM_PRIOR_CONFIDENCE,
          extractedFrom,
          actorType: params.actorType,
          actorId: params.actorId,
        }),
      );
    }
    return wired;
  },
};

import type { Prospect, ProspectResearchProfile } from "@prisma/client";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { identityRepository } from "../db/repositories/identity.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { prospectResearchProfileRepository } from "../db/repositories/prospect-research-profile.repository.js";
import { agentService } from "./agent.service.js";
import { capProspectCandidateConfidence } from "../domain/prospect-research/confidence.js";
import { verifyContactType } from "../domain/prospect-research/contact-type.js";
import { EVIDENCE_LEVEL_CONFIDENCE, isKnownFixtureUrl, realProspectImportSchema, type RealProspectImportInput } from "../domain/prospect-research/real-prospect-import.js";
import { buildRealWorldTag } from "../domain/real-world/reality.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { auditService } from "./audit.service.js";
import { prospectService } from "./prospect.service.js";

const UNKNOWN = "UNKNOWN";

export interface RealProspectImportResult {
  prospect: Prospect;
  profile: ProspectResearchProfile;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** "" for the honest UNKNOWN sentinel — never treated as a real match against another UNKNOWN. */
function normalizeWebsite(value: string): string {
  if (normalize(value) === "unknown") return "";
  return normalize(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * The operator-fed REAL prospect-research ingestion boundary (Part 47,
 * docs pending) — the ONLY new logic here is validation, deduplication,
 * and audit trail. Every actual persistence decision reuses existing,
 * unmodified pieces: `prospectService.create()` (Prospect row + its own
 * CREATE_PROSPECT audit entry + PROSPECT_DISCOVERED event, unchanged),
 * `prospectResearchProfileRepository.create()` (same table
 * prospectResearcherService already writes), `verifyContactType()` and
 * `capProspectCandidateConfidence()` (same structural guards, unchanged).
 * This never drafts a message, never approves anything, never sends
 * anything — it stops at a `Prospect` in status `DISCOVERED`, exactly
 * where prospectResearcherService's own output starts, so the
 * existing, unmodified qualification/drafting/approval pipeline can
 * take over from there.
 */
export const realProspectImportService = {
  async import(rawInput: RealProspectImportInput): Promise<RealProspectImportResult> {
    const parsed = realProspectImportSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(`Invalid REAL prospect import payload: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    const input = parsed.data;

    // Deliberately narrow (the architectural rule): this path accepts ONLY reality="REAL".
    // A DEV_FIXTURE candidate already has prospectResearcherService as its route in.
    if (input.reality !== "REAL") {
      throw new ValidationError(`realProspectImportService only accepts reality="REAL" (got "${input.reality}") — a DEV_FIXTURE candidate must go through prospectResearcherService instead.`);
    }
    if (isKnownFixtureUrl(input.sourceUrl)) {
      throw new ValidationError(`sourceUrl "${input.sourceUrl}" is a known fixture/placeholder pattern (or not a valid http(s) URL) — cannot be REAL.`);
    }

    const opportunity = await opportunityRepository.findById(input.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", input.opportunityId);
    const icpProfile = await icpProfileRepository.findById(input.icpProfileId);
    if (!icpProfile) throw new NotFoundError("IcpProfile", input.icpProfileId);
    if (icpProfile.opportunityId !== input.opportunityId) {
      throw new ValidationError(`IcpProfile ${icpProfile.id} belongs to a different opportunity than ${input.opportunityId}.`);
    }
    await agentService.getAgentOrThrow(input.importedByAgentId);
    const importerIdentity = await identityRepository.findById(input.importedByIdentityId);
    if (!importerIdentity) throw new NotFoundError("Identity", input.importedByIdentityId);
    if (importerIdentity.type !== "HUMAN") {
      throw new ValidationError(`importedByIdentityId ${input.importedByIdentityId} is not a HUMAN identity — a REAL import must be attributed to a human operator.`);
    }

    // Deduplication (Requirement 4) — never silently create a second row for the same business,
    // and never merge: a genuine duplicate is rejected outright, distinct businesses are untouched.
    const existingProspects = await prospectRepository.listForOpportunity(input.opportunityId);
    const sourceUrlMatch = existingProspects.find((p) => p.sourceUrl === input.sourceUrl);
    if (sourceUrlMatch) {
      throw new ValidationError(`A prospect for this exact sourceUrl already exists in this opportunity (prospect ${sourceUrlMatch.id}) — refusing to create a duplicate.`);
    }
    const existingProfiles = await prospectResearchProfileRepository.listForOpportunity(input.opportunityId);
    const normalizedName = normalize(input.businessName);
    const normalizedLocation = normalize(input.location);
    const normalizedWebsite = normalizeWebsite(input.website);
    const nameLocationMatch = existingProfiles.find((p) => normalize(p.businessName) === normalizedName && normalize(p.location) === normalizedLocation);
    if (nameLocationMatch) {
      throw new ValidationError(`A prospect with the same business name + location already exists in this opportunity (prospect ${nameLocationMatch.prospectId}) — refusing to create a duplicate.`);
    }
    if (normalizedWebsite) {
      const websiteMatch = existingProfiles.find((p) => normalizeWebsite(p.website) === normalizedWebsite);
      if (websiteMatch) {
        throw new ValidationError(`A prospect with the same website already exists in this opportunity (prospect ${websiteMatch.prospectId}) — refusing to create a duplicate.`);
      }
    }

    // buildRealWorldTag itself refuses an empty note for REAL — the one place this claim is actually checked, not merely requested.
    buildRealWorldTag({ reality: "REAL", experimentId: null, note: input.evidence });

    const verifiedContactType = verifyContactType({
      claimedType: input.contactType,
      contactSource: input.contactSource,
      publicContactChannel: input.publicContactChannel,
    });

    const allSignals = [...input.workflowSignals, ...input.painHypotheses];
    const confidence = capProspectCandidateConfidence(EVIDENCE_LEVEL_CONFIDENCE[input.evidenceLevel], allSignals);

    const prospect = await prospectService.create({
      opportunityId: input.opportunityId,
      icpProfileId: input.icpProfileId,
      organization: input.businessName,
      role: input.decisionMaker ?? UNKNOWN,
      publicContactChannel: input.publicContactChannel,
      source: input.sourceType,
      sourceUrl: input.sourceUrl,
      discoveredByAgentId: input.importedByAgentId,
      actorType: "HUMAN",
      actorId: input.importedByIdentityId,
    });

    const profile = await prospectResearchProfileRepository.create({
      prospectId: prospect.id,
      businessName: input.businessName,
      industry: input.industry,
      location: input.location,
      website: input.website,
      contactType: verifiedContactType,
      contactSource: input.contactSource,
      decisionMaker: input.decisionMaker ?? UNKNOWN,
      workflowSignals: toJsonString(input.workflowSignals),
      painHypotheses: toJsonString(input.painHypotheses),
      confidence,
      reality: "REAL",
      provenanceNote: input.evidence,
      createdByAgentId: input.importedByAgentId,
    });

    await auditService.record({
      actorType: "HUMAN",
      actorId: input.importedByIdentityId,
      action: "IMPORT_REAL_PROSPECT",
      resourceType: "PROSPECT",
      resourceId: prospect.id,
      result: "SUCCESS",
      metadata: {
        opportunityId: input.opportunityId,
        icpProfileId: input.icpProfileId,
        sourceUrl: input.sourceUrl,
        sourceType: input.sourceType,
        reality: "REAL",
        evidenceLevel: input.evidenceLevel,
        confidence,
        contactType: verifiedContactType,
        prospectId: prospect.id,
        prospectResearchProfileId: profile.id,
        suppliedPayload: input,
      },
    });

    return { prospect, profile };
  },
};

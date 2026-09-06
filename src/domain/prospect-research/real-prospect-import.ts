import { z } from "zod";
import { CONTACT_TYPES } from "./contact-type.js";
import { FINDING_PROVENANCES } from "../customer-discovery/provenance.js";
import { REALITY_LABELS } from "../real-world/reality.types.js";

/**
 * The operator-fed REAL prospect-research ingestion boundary (Part 47)
 * — the exact same shape of problem researchSignalImportService
 * already solved for research SIGNALS, now for PROSPECTS: this
 * environment's dev-fixture prospectResearcherService can never
 * produce a REAL candidate (no live research tool, no live model key),
 * so an operator who has independently verified a real public business
 * needs a governed path to feed it in — reusing Prospect,
 * ProspectResearchProfile, FindingProvenance, and the existing
 * qualification/drafting/approval pipeline unchanged, never a second
 * discovery implementation.
 *
 * Deliberately narrow: this schema accepts ONLY reality="REAL" — a
 * caller wanting a DEV_FIXTURE candidate already has
 * prospectResearcherService for that. There is no generic "import
 * anything as REAL" mode.
 */
export const realProspectImportSchema = z.object({
  opportunityId: z.string().min(1),
  icpProfileId: z.string().min(1),
  businessName: z.string().min(1),
  /** A real value or the literal string "UNKNOWN" — same sentinel convention as prospectResearcherService's own fields, never a guess. */
  industry: z.string().min(1),
  location: z.string().min(1),
  website: z.string().min(1),
  publicContactChannel: z.string().min(1),
  contactType: z.enum(CONTACT_TYPES),
  /** Required, non-empty — the concrete proxy that this is public business information the operator actually found somewhere, not a private contact assumed or guessed (Requirement 2). */
  contactSource: z.string().min(1),
  /** A public role/title only (e.g. "Owner") — null when not publicly evidenced, never a private individual's name. */
  decisionMaker: z.string().min(1).nullable(),
  workflowSignals: z.array(z.object({ text: z.string().min(1), provenance: z.enum(FINDING_PROVENANCES) })),
  painHypotheses: z.array(z.object({ text: z.string().min(1), provenance: z.enum(FINDING_PROVENANCES) })),
  /** How the operator actually verified this is real — becomes the ProspectResearchProfile's provenanceNote AND the RealWorldTag's required-for-REAL note (buildRealWorldTag refuses an empty one). */
  evidence: z.string().min(1),
  sourceUrl: z.string().min(1),
  /** Where this business was found (e.g. "public_business_directory", "company_website") — maps to Prospect.source, the same field prospectResearcherService already populates with its own tool id. */
  sourceType: z.string().min(1),
  evidenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  /** Must be exactly "REAL" — enforced again, explicitly, in the service (not just here) so the rejection reason is unambiguous. */
  reality: z.enum(REALITY_LABELS),
  importedByAgentId: z.string().min(1),
  importedByIdentityId: z.string().min(1),
});
export type RealProspectImportInput = z.infer<typeof realProspectImportSchema>;

/** Reuses the same LOW/MEDIUM/HIGH vocabulary Evidence.reliability already established elsewhere in this codebase — never a second scale. A starting point only: capProspectCandidateConfidence() (confidence.ts, unchanged) still caps the result unless a signal is OBSERVED. */
export const EVIDENCE_LEVEL_CONFIDENCE: Readonly<Record<"LOW" | "MEDIUM" | "HIGH", number>> = {
  LOW: 0.3,
  MEDIUM: 0.5,
  HIGH: 0.7,
};

/** Hostnames/patterns already used throughout this codebase's own dev fixtures (research-signal-import, prospect-researcher, discovery-experiment) — a REAL import can never point at one of these, by construction. Not an exhaustive real-vs-fake classifier — genuine REAL provenance ultimately rests on the operator's own audited attestation (`evidence`), matching researchSignalImportService's own precedent. */
const KNOWN_FIXTURE_HOSTNAMES = ["dev-fixture.local", "example.com", "example.org", "example.net", "localhost", "127.0.0.1"];

export function isKnownFixtureUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // an unparseable URL can never be a genuine public source reference — treated as fixture-grade, rejected the same way.
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  return KNOWN_FIXTURE_HOSTNAMES.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
}

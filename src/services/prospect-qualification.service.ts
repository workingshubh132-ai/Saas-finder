import type { IcpProfile, Prospect } from "@prisma/client";
import { z } from "zod";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { ICP_FIT_LEVELS, PROSPECT_QUALIFICATION_STATUSES } from "../domain/prospect/qualification.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";
import { prospectService } from "./prospect.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/**
 * Zero tool calls (docs/M5_ARCHITECTURE_PROPOSAL.md §5, §24) — real
 * judgment over already-discovered public information ("does this
 * public evidence plausibly indicate ICP fit" is not a deterministic
 * lookup), same bounded-reasoning shape as icpAnalystService/
 * ceoReasoningService.
 */
export const PROSPECT_QUALIFICATION_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const qualificationSchema = z.object({
  qualificationStatus: z.enum(PROSPECT_QUALIFICATION_STATUSES),
  icpFit: z.enum(ICP_FIT_LEVELS),
  reasonForMatch: z.string().min(1),
  unknowns: z.array(z.string().min(1)),
});
type Qualification = z.infer<typeof qualificationSchema>;

const PROSPECT_QUALIFICATION_SYSTEM_PROMPT =
  "You are Prospect Qualification for VentureForge (docs/M5_ARCHITECTURE_PROPOSAL.md §5). Given one prospect's " +
  "publicly-discovered organization/role/reason-for-match and the ICP it was matched against, decide: QUALIFIED " +
  "(clearly fits the ICP, worth drafting outreach to), REJECTED (clearly does NOT fit, or matches an explicit " +
  "exclusion), or UNQUALIFIED (fit is genuinely unclear from what's known — an honest, valid outcome, never forced " +
  "toward QUALIFIED or REJECTED to avoid it). Also report icpFit (HIGH/MEDIUM/LOW — how strong the match is, " +
  "independent of the status), a real reasonForMatch citing WHICH ICP criteria matched or didn't and on what public " +
  "evidence (never a bare score with no explanation), and an honest unknowns list — what remains genuinely unknown " +
  "about this prospect from public information alone (actual pain level and willingness to pay are almost always " +
  "unknown until a real conversation happens; do not claim to know them from public discussion alone). " +
  'Respond with ONLY JSON matching: {"qualificationStatus": "QUALIFIED"|"REJECTED"|"UNQUALIFIED", "icpFit": ' +
  '"HIGH"|"MEDIUM"|"LOW", "reasonForMatch": string, "unknowns": string[]}';

export interface RunProspectQualificationParams {
  agentId: string;
  prospectId: string;
  startedBy: AuthenticatedActor;
}

export interface ProspectQualificationResult {
  prospect: Prospect;
}

function buildQualificationPrompt(prospect: Prospect, icp: IcpProfile): string {
  const exclusions = fromJsonString<string[]>(icp.exclusions, []);
  return [
    `Prospect — organization: ${prospect.organization}`,
    `Prospect — role: ${prospect.role}`,
    `Prospect — public contact channel: ${prospect.publicContactChannel}`,
    `Prospect — source: ${prospect.source} (${prospect.sourceUrl})`,
    "",
    `ICP — role: ${icp.role}`,
    `ICP — industry: ${icp.industry}`,
    `ICP — problem exposure: ${icp.problemExposure}`,
    `ICP — likely frequency: ${icp.likelyFrequency}`,
    `ICP — geography: ${icp.geography}`,
    `ICP — technology: ${icp.technology}`,
    `ICP — exclusions: ${exclusions.length > 0 ? exclusions.join(", ") : "(none)"}`,
  ].join("\n");
}

const DEFAULT_UNKNOWNS = ["Actual pain level (not directly stated in public discussion)", "Willingness to pay (not directly stated in public discussion)"];

/**
 * DEVELOPMENT ONLY — a genuinely input-driven, deterministic stand-in,
 * never a static stub (same discipline as every other dev fixture in
 * this codebase): checks the prospect's own organization/role text
 * against the ICP's exclusions and role, so a prospect seeded to match
 * an exclusion or to clearly mismatch the ICP's role produces a
 * genuinely different (REJECTED/UNQUALIFIED) outcome, not a scripted
 * "always QUALIFIED."
 */
function buildDevQualificationFixture(prospect: Prospect, icp: IcpProfile): Qualification {
  const exclusions = fromJsonString<string[]>(icp.exclusions, []);
  const haystack = `${prospect.organization} ${prospect.role}`.toLowerCase();

  const matchedExclusion = exclusions.find((ex) => ex.trim().length > 0 && haystack.includes(ex.toLowerCase()));
  if (matchedExclusion) {
    return {
      qualificationStatus: "REJECTED",
      icpFit: "LOW",
      reasonForMatch: `[DEV FIXTURE] Organization/role text matches an explicit ICP exclusion: "${matchedExclusion}".`,
      unknowns: DEFAULT_UNKNOWNS,
    };
  }

  const icpRoleWords = icp.role.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const roleOverlap = icpRoleWords.filter((w) => haystack.includes(w));
  const overlapRatio = icpRoleWords.length > 0 ? roleOverlap.length / icpRoleWords.length : 0;

  if (overlapRatio >= 0.5) {
    return {
      qualificationStatus: "QUALIFIED",
      icpFit: overlapRatio >= 0.9 ? "HIGH" : "MEDIUM",
      reasonForMatch: `[DEV FIXTURE] Prospect's organization/role text (${roleOverlap.length}/${icpRoleWords.length} significant ICP-role word(s)) overlaps the ICP's own role "${icp.role}".`,
      unknowns: DEFAULT_UNKNOWNS,
    };
  }

  return {
    qualificationStatus: "UNQUALIFIED",
    icpFit: "LOW",
    reasonForMatch: `[DEV FIXTURE] Prospect's organization/role text does not clearly overlap the ICP's own role "${icp.role}" (${roleOverlap.length}/${icpRoleWords.length} significant word(s) matched) — genuinely unclear, not excluded.`,
    unknowns: [...DEFAULT_UNKNOWNS, "Whether this prospect's role actually matches the ICP at all"],
  };
}

/** Coarser than qualificationStatus by design (docs/M5_ARCHITECTURE_PROPOSAL.md §8): UNQUALIFIED and REJECTED both mean "does not proceed," collapsing to the same lifecycle status, while qualificationStatus preserves the finer distinction for a human reading the record. */
function statusForQualification(qualificationStatus: Qualification["qualificationStatus"]): "QUALIFIED" | "REJECTED" {
  return qualificationStatus === "QUALIFIED" ? "QUALIFIED" : "REJECTED";
}

/**
 * Prospect Qualification (docs/M5_ARCHITECTURE_PROPOSAL.md §5) — never
 * a bare score. Every assessment is explainable: qualificationStatus +
 * icpFit + reasonForMatch + an honest unknowns list.
 */
export const prospectQualificationService = {
  async run(params: RunProspectQualificationParams): Promise<RunOutcome<ProspectQualificationResult>> {
    const prospect = await prospectRepository.findById(params.prospectId);
    if (!prospect) throw new NotFoundError("Prospect", params.prospectId);
    if (!prospect.icpProfileId) throw new ValidationError(`Prospect ${prospect.id} has no ICP profile to qualify against.`);
    const icpProfile = await icpProfileRepository.findById(prospect.icpProfileId);
    if (!icpProfile) throw new NotFoundError("IcpProfile", prospect.icpProfileId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { prospectId: params.prospectId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: qualification } = await completeWithValidation(handle.callModel, qualificationSchema, {
          systemPrompt: PROSPECT_QUALIFICATION_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildQualificationPrompt(prospect, icpProfile) }],
          devFixtureResponse: buildDevQualificationFixture(prospect, icpProfile),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const updated = await prospectService.setQualification(
          prospect.id,
          statusForQualification(qualification.qualificationStatus),
          {
            qualificationStatus: qualification.qualificationStatus,
            icpFit: qualification.icpFit,
            reasonForMatch: qualification.reasonForMatch,
            unknowns: toJsonString(qualification.unknowns),
          },
          { actorType: "AGENT", actorId: params.agentId },
        );

        return { prospect: updated };
      },
      PROSPECT_QUALIFICATION_BUDGET,
    );
  },
};

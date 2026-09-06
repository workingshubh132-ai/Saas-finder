import type { Claim, Evidence, IcpProfile, Opportunity } from "@prisma/client";
import { z } from "zod";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { extractTargetingSignals, selectTechnologySignal } from "../domain/icp-profile/extract-targeting-signals.js";
import { icpFieldGroundingSchema, type IcpFieldGrounding } from "../domain/icp-profile/icp-field-grounding.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { icpClaimService } from "./icp-claim.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/**
 * Zero tool calls, by construction (docs/M5_ARCHITECTURE_PROPOSAL.md
 * §3, §24) — one bounded reasoning call over already-persisted claims
 * and evidence, the identical `maxToolCalls: 0` shape ceo-reasoning.service.ts
 * already uses for the same reason: synthesizing who is affected is
 * genuine judgment over existing facts, not something that needs a
 * fresh search. The ICP Analyst's registered Agent should additionally
 * hold zero AgentPermission grants (§24) — a second, independent
 * enforcement layer beyond this budget.
 */
export const ICP_ANALYST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const icpGenerationSchema = z.object({
  industry: z.string().min(1),
  companySizeMin: z.number().int().min(0).nullable(),
  companySizeMax: z.number().int().min(0).nullable(),
  role: z.string().min(1),
  problemExposure: z.string().min(1),
  likelyFrequency: z.string().min(1),
  geography: z.string().min(1),
  technology: z.string().min(1),
  exclusions: z.array(z.string().min(1)),
  fieldGrounding: icpFieldGroundingSchema,
});
type IcpGeneration = z.infer<typeof icpGenerationSchema>;

const ICP_FIELDS = ["industry", "companySize", "role", "problemExposure", "likelyFrequency", "geography", "technology", "exclusions"] as const;

const ICP_ANALYST_SYSTEM_PROMPT =
  "You are the ICP (Ideal Customer Profile) Analyst for VentureForge (docs/M5_ARCHITECTURE_PROPOSAL.md §3). Given an " +
  "opportunity's own claims and evidence, describe WHO should be talked to next: industry, company size range, role, " +
  "problem exposure (how they encounter this problem), likely frequency, geography, technology context, and explicit " +
  "exclusions (who this ICP deliberately does NOT target). Every field must be grounded ONLY in what the claims/evidence " +
  "actually say — do not invent arbitrary demographic assumptions. When a field has no real grounding, you MUST still " +
  "provide a conservative, wide value (e.g. \"Any\" for industry/technology, null for companySizeMin/Max, an empty " +
  "exclusions array) and mark it ASSUMED in fieldGrounding with an EMPTY groundedInClaimIds array — never invent " +
  "specificity to look more confident than the evidence supports. For each of the 8 fields (industry, companySize, " +
  "role, problemExposure, likelyFrequency, geography, technology, exclusions), report exactly one fieldGrounding entry " +
  "naming which real claim ids (if any) justify it. " +
  'Respond with ONLY JSON matching: {"industry": string, "companySizeMin": number|null, "companySizeMax": number|null, ' +
  '"role": string, "problemExposure": string, "likelyFrequency": string, "geography": string, "technology": string, ' +
  '"exclusions": string[], "fieldGrounding": [{"field": string, "groundedInClaimIds": string[], "status": ' +
  '"EVIDENCED"|"ASSUMED", "reasoning": string}]}';

export interface RunIcpAnalystParams {
  agentId: string;
  opportunityId: string;
  startedBy: AuthenticatedActor;
}

export interface IcpAnalystResult {
  icpProfile: IcpProfile;
  /** The ICP's testable assumptions, wired into real Claim rows (docs/M5_ARCHITECTURE_PROPOSAL.md §4) — role/problemExposure/likelyFrequency, in that order. */
  wiredClaims: Claim[];
}

function buildIcpPrompt(opportunity: Opportunity, claims: readonly Claim[], evidence: readonly Evidence[]): string {
  const claimLines = claims.map((c) => `- [id=${c.id}] [${c.claimType}] status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  const evidenceLines = evidence.slice(0, 20).map((e) => `- [id=${e.id}] (${e.sourceType}, reliability=${e.reliability}): ${e.claim}`);
  return [
    `Opportunity: ${opportunity.title}`,
    `Target customer (as currently understood): ${opportunity.targetCustomer}`,
    `Problem: ${opportunity.problem}`,
    `Description: ${opportunity.description}`,
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none extracted yet)"]),
    "",
    `Evidence (${evidence.length}${evidence.length > 20 ? ", showing first 20" : ""}):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none collected yet)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — a genuinely input-driven stand-in, never a static
 * stub (same discipline as buildDevCeoFixture/buildDevValidatorFixture):
 * fields with a real, on-point Claim behind them are derived from that
 * claim's own statement and marked EVIDENCED; every other field gets a
 * conservative, wide default and an honest ASSUMED with an empty
 * groundedInClaimIds array — the same "ungrounded is allowed, invented
 * is not" rule the real model is instructed to follow (§3).
 */
function buildDevIcpFixture(opportunity: Opportunity, claims: readonly Claim[]): IcpGeneration {
  const grounding: IcpFieldGrounding = [];
  const byType = (type: string): Claim | undefined => claims.find((c) => c.claimType === type && c.status !== "CONTRADICTED");

  const segmentClaim = byType("CUSTOMER_SEGMENT");
  const role = segmentClaim?.statement ?? opportunity.targetCustomer;
  grounding.push({
    field: "role",
    groundedInClaimIds: segmentClaim ? [segmentClaim.id] : [],
    status: segmentClaim ? "EVIDENCED" : "ASSUMED",
    reasoning: segmentClaim ? `[DEV FIXTURE] Derived from the CUSTOMER_SEGMENT claim.` : `[DEV FIXTURE] No CUSTOMER_SEGMENT claim yet — fell back to the opportunity's own targetCustomer, unresolved further.`,
  });

  const problemClaim = byType("CUSTOMER_PROBLEM");
  const problemExposure = problemClaim?.statement ?? "Experiences the core problem described in the opportunity, exposure not yet specifically characterized.";
  grounding.push({
    field: "problemExposure",
    groundedInClaimIds: problemClaim ? [problemClaim.id] : [],
    status: problemClaim ? "EVIDENCED" : "ASSUMED",
    reasoning: problemClaim ? `[DEV FIXTURE] Derived from the CUSTOMER_PROBLEM claim.` : `[DEV FIXTURE] No CUSTOMER_PROBLEM claim yet — conservative default.`,
  });

  const frequencyClaim = byType("FREQUENCY");
  const likelyFrequency = frequencyClaim?.statement ?? "Unknown — not yet grounded in evidence.";
  grounding.push({
    field: "likelyFrequency",
    groundedInClaimIds: frequencyClaim ? [frequencyClaim.id] : [],
    status: frequencyClaim ? "EVIDENCED" : "ASSUMED",
    reasoning: frequencyClaim ? `[DEV FIXTURE] Derived from the FREQUENCY claim.` : `[DEV FIXTURE] No FREQUENCY claim yet — conservative default.`,
  });

  for (const field of ["industry", "companySize", "geography", "technology", "exclusions"] as const) {
    grounding.push({
      field,
      groundedInClaimIds: [],
      status: "ASSUMED",
      reasoning: `[DEV FIXTURE] No claim type in this opportunity's model directly evidences ${field} — conservative, wide default used rather than an invented assumption.`,
    });
  }

  return {
    industry: "Any — not evidenced, deliberately unrestricted",
    companySizeMin: null,
    companySizeMax: null,
    role,
    problemExposure,
    likelyFrequency,
    geography: "Not geographically restricted — not evidenced",
    technology: "Any — not evidenced",
    exclusions: [],
    fieldGrounding: grounding,
  };
}

/**
 * The ICP Analyst (docs/M5_ARCHITECTURE_PROPOSAL.md §3) — synthesizes
 * WHO should be talked to next from an opportunity's own claims and
 * evidence, never from nothing. Historized: every run creates a NEW
 * IcpProfile row, never overwrites an earlier targeting decision (§33).
 */
export const icpAnalystService = {
  async run(params: RunIcpAnalystParams): Promise<RunOutcome<IcpAnalystResult>> {
    const opportunity = await opportunityRepository.findById(params.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", params.opportunityId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { opportunityId: params.opportunityId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const claims = await claimRepository.listForOpportunity(params.opportunityId);
        const evidence = await opportunityRepository.listEvidence(params.opportunityId);
        // Evidence-derived, not model-derived (Part 46) — runs identically
        // whether the reasoning above is a live model call or the dev
        // fixture, so real technology/workflow signal is never lost to a
        // thin dev-fixture extraction.
        const targetingSignals = extractTargetingSignals(
          evidence.map((e) => ({ id: e.id, text: `${e.claim} ${fromJsonString<{ content?: string }>(e.metadata, {}).content ?? ""}` })),
        );
        const technologySignal = selectTechnologySignal(targetingSignals);

        const { value: generation } = await completeWithValidation(handle.callModel, icpGenerationSchema, {
          systemPrompt: ICP_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildIcpPrompt(opportunity, claims, evidence) }],
          devFixtureResponse: buildDevIcpFixture(opportunity, claims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const knownFields = new Set(ICP_FIELDS as readonly string[]);
        const groundingByField = new Map(generation.fieldGrounding.filter((g) => knownFields.has(g.field)).map((g) => [g.field, g] as const));
        const fieldGrounding: IcpFieldGrounding = ICP_FIELDS.map(
          (field) => groundingByField.get(field) ?? { field, groundedInClaimIds: [], status: "ASSUMED", reasoning: "Not explicitly grounded by the ICP Analyst; defaulted to ASSUMED." },
        );

        // A real, evidence-backed technology signal takes precedence over
        // the model/fixture's own "Any — not evidenced" default (Design
        // Requirement A) — never the reverse, and never upgraded past what
        // extractTargetingSignals itself already marked EVIDENCED/INFERRED
        // (Design Requirement B: one named platform never silently becomes
        // a universal requirement).
        const technology = technologySignal?.label ?? generation.technology;
        if (technologySignal) {
          const technologyIndex = fieldGrounding.findIndex((g) => g.field === "technology");
          fieldGrounding[technologyIndex] = {
            field: "technology",
            groundedInClaimIds: [],
            groundedInEvidenceIds: technologySignal.groundedEvidenceIds,
            status: technologySignal.provenance === "EVIDENCED" ? "EVIDENCED" : "INFERRED",
            reasoning: technologySignal.reasoning,
          };
        }

        const icpProfile = await icpProfileRepository.create({
          opportunityId: params.opportunityId,
          industry: generation.industry,
          companySizeMin: generation.companySizeMin,
          companySizeMax: generation.companySizeMax,
          role: generation.role,
          problemExposure: generation.problemExposure,
          likelyFrequency: generation.likelyFrequency,
          geography: generation.geography,
          technology,
          exclusions: toJsonString(generation.exclusions),
          fieldGrounding: toJsonString(fieldGrounding),
          evidenceTargetingSignals: targetingSignals.length > 0 ? toJsonString(targetingSignals) : null,
          generatedByAgentId: params.agentId,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_ICP_PROFILE",
          resourceType: "OPPORTUNITY",
          resourceId: params.opportunityId,
          result: "SUCCESS",
          metadata: { icpProfileId: icpProfile.id },
        });

        const wiredClaims = await icpClaimService.wireForIcpProfile(icpProfile, { actorType: "AGENT", actorId: params.agentId });

        return { icpProfile, wiredClaims };
      },
      ICP_ANALYST_BUDGET,
    );
  },
};

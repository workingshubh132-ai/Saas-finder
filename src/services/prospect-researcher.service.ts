import type { Prospect } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { prospectResearchProfileRepository } from "../db/repositories/prospect-research-profile.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { capProspectCandidateConfidence } from "../domain/prospect-research/confidence.js";
import { CONTACT_TYPES, verifyContactType } from "../domain/prospect-research/contact-type.js";
import { FINDING_PROVENANCES } from "../domain/customer-discovery/provenance.js";
import { buildRealWorldTag } from "../domain/real-world/reality.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import type { SearchToolOutput } from "../tools/source-search.tool.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";
import { prospectService } from "./prospect.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 1536;
const SEARCH_RESULTS_PER_QUERY = 5;
const SEARCH_QUERY_MAX_LENGTH = 200;
/** Hacker News's general "what are people discussing/using" framing fits ICP discovery better than Stack Exchange's Q&A framing (matches competitor-analyst.service.ts's own choice — docs/SOURCE_ADAPTERS.md). */
const PROSPECT_SEARCH_TOOL_ID = "hacker_news";

/**
 * One search + one extraction call — no planning call needed, the
 * query is built deterministically from the approved ICP
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §6). The one real tool call this
 * agent makes is the unmodified, Guardian-gated SourceSearchTool
 * (`READ_WEB`) — no new source adapter, no capability beyond what the
 * Competitor Analyst already has (§6, §10).
 */
export const PROSPECT_RESEARCHER_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 3,
  maxToolCalls: 1,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const provenanceTaggedItemSchema = z.object({
  text: z.string().min(1),
  provenance: z.enum(FINDING_PROVENANCES),
});

const prospectExtractionSchema = z.object({
  prospects: z.array(
    z.object({
      /** Index into the search results actually given — never a model-supplied URL string (§7, anti-spoofing, mirrors Signal.source's own precedent). */
      sourceIndex: z.number().int().min(0),
      organization: z.string().min(1),
      role: z.string().min(1),
      /** A public BUSINESS contact point only — the discussion thread itself, a company contact page, a public directory listing. NEVER a personal email/phone (§10). */
      publicContactChannel: z.string().min(1),
      reasonForMatch: z.string().min(1),
      /// Discovery vertical slice additions — docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md. Every field here is
      /// either a real value drawn from the search result text or the literal string "UNKNOWN" — never guessed.
      industry: z.string().min(1),
      location: z.string().min(1),
      website: z.string().min(1),
      /** The model's own claim — verifyContactType() re-checks WHATSAPP structurally before this is ever trusted. */
      contactType: z.enum(CONTACT_TYPES),
      contactSource: z.string().min(1),
      /** A public role/title only (e.g. "Owner") — never a private individual's name unless the business itself publicly lists that name as its contact. */
      decisionMaker: z.string().min(1),
      workflowSignals: z.array(provenanceTaggedItemSchema),
      painHypotheses: z.array(provenanceTaggedItemSchema),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
type ProspectExtraction = z.infer<typeof prospectExtractionSchema>;
type ProspectExtractionItem = ProspectExtraction["prospects"][number];

const PROSPECT_RESEARCHER_SYSTEM_PROMPT =
  "You are the Prospect Researcher for VentureForge (docs/M5_ARCHITECTURE_PROPOSAL.md §6, §10; " +
  "docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md). Given an Ideal Customer Profile (ICP) and raw public search " +
  "results, identify any real organizations/individuals ACTUALLY discussed in the results who plausibly match the " +
  "ICP — never invent a prospect that isn't there; finding zero is valid, real information, not a failure. For each " +
  "match, report the sourceIndex of the exact search result it came from, the organization/role as actually stated " +
  "or reasonably inferred from that result's own text, and a publicContactChannel that is ALWAYS a public, " +
  "business-facing channel — the discussion thread itself, a company contact page, a public directory listing — " +
  "and NEVER a personal email, personal phone number, or anything you guessed rather than observed in the text. " +
  "Also report: industry/location/website (a real value from the text, or the literal string \"UNKNOWN\" if not " +
  'stated — never a guess); contactType (one of EMAIL, CONTACT_FORM, PHONE, WHATSAPP, DIRECTORY, OTHER) — WHATSAPP ' +
  "may ONLY be used when the text itself explicitly names WhatsApp or shows a wa.me/WhatsApp link, NEVER merely " +
  "because a phone number is present; contactSource describing exactly where this channel was found; decisionMaker " +
  'as a public ROLE/TITLE only (e.g. "Owner", "Operations Manager") — NEVER a private individual\'s name unless the ' +
  "business's own public text lists that name as its contact; workflowSignals and painHypotheses as short lists of " +
  '{text, provenance}, where provenance is OBSERVED (the text itself states this), INFERRED (you reasonably read ' +
  "between the lines), or UNKNOWN (you are noting an open question, not a finding) — never mark something OBSERVED " +
  "unless the source text actually says it. Do not bypass, authenticate against, or scrape anything beyond the " +
  "search results you were given. " +
  'Respond with ONLY JSON matching: {"prospects": [{"sourceIndex": number, "organization": string, "role": string, ' +
  '"publicContactChannel": string, "reasonForMatch": string, "industry": string, "location": string, "website": ' +
  'string, "contactType": string, "contactSource": string, "decisionMaker": string, "workflowSignals": ' +
  '[{"text": string, "provenance": string}], "painHypotheses": [{"text": string, "provenance": string}], ' +
  '"confidence": number}]}';

export interface RunProspectResearcherParams {
  agentId: string;
  icpProfileId: string;
  startedBy: AuthenticatedActor;
}

export interface ProspectResearcherResult {
  prospects: Prospect[];
}

interface RawSearchResult {
  title: string;
  content: string;
  url: string | null;
}

function buildResearchPrompt(icp: { role: string; industry: string; problemExposure: string; geography: string; exclusions: string }, results: readonly RawSearchResult[]): string {
  const resultLines = results.map((r, i) => `[${i}] (url=${r.url ?? "none"}) ${r.title}: ${r.content.slice(0, 300)}`);
  return [
    `ICP — role: ${icp.role}`,
    `ICP — industry: ${icp.industry}`,
    `ICP — problem exposure: ${icp.problemExposure}`,
    `ICP — geography: ${icp.geography}`,
    `ICP — exclusions: ${icp.exclusions}`,
    "",
    `Search results (${results.length}):`,
    ...(resultLines.length > 0 ? resultLines : ["(no search results returned)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — derived from the actual search results, never a
 * static stub (same discipline as buildDevCompetitorFixture): one
 * candidate per result that has a real URL (results with no URL cannot
 * back a Prospect — source provenance is required, §7), honestly
 * labeled as a discussion participant rather than claiming a precision
 * the fixture can't actually have. The new discovery-slice fields are
 * equally honest: industry/location/website are "UNKNOWN" (a dev
 * fixture has no more information than the title/content already
 * used), contactType is OTHER (the channel is the thread URL itself,
 * never WHATSAPP without real structural evidence), and every
 * workflow/pain item is explicitly INFERRED, never OBSERVED.
 */
function buildDevProspectFixture(icpRole: string, results: readonly RawSearchResult[]): ProspectExtraction {
  const prospects = results
    .map((r, sourceIndex) => ({ r, sourceIndex }))
    .filter(({ r }) => r.url !== null)
    .map(({ r, sourceIndex }) => ({
      sourceIndex,
      // The per-result discriminator (#index) must survive truncation regardless of how long the ICP-derived
      // query text made the title — leading with it, rather than burying it after the title, is what keeps
      // every result mapping to a genuinely distinct "organization" instead of silently colliding into one.
      organization: `[DEV FIXTURE] Participant #${sourceIndex + 1} in discussion: "${r.title}"`.slice(0, 200),
      role: icpRole,
      publicContactChannel: r.url as string,
      reasonForMatch: `[DEV FIXTURE] This discussion's own text was returned for a query built from the ICP's role/industry/problem-exposure — no real model reasoning was performed.`,
      industry: "UNKNOWN",
      location: "UNKNOWN",
      website: "UNKNOWN",
      contactType: "OTHER" as const,
      contactSource: "The discussion thread URL itself — same as publicContactChannel.",
      decisionMaker: "UNKNOWN",
      workflowSignals: [{ text: `[DEV FIXTURE] Discussion thread title: "${r.title}"`, provenance: "INFERRED" as const }],
      painHypotheses: [{ text: `[DEV FIXTURE] Discussion thread excerpt: "${r.content.slice(0, 120)}"`, provenance: "INFERRED" as const }],
      confidence: 0.3,
    }));
  return { prospects };
}

/**
 * The Prospect Researcher (docs/M5_ARCHITECTURE_PROPOSAL.md §6-7, §10;
 * docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md) — finds candidates
 * matching an approved ICP using the same permitted, public sources the
 * Competitor Analyst already searches. Never writes a Prospect without
 * a real, dereferenceable source + sourceUrl; never writes a personal
 * contact field. Deduplicates against already-discovered prospects for
 * this opportunity by sourceUrl — running the researcher twice must not
 * double up the same discussion thread as two separate prospects. Also
 * persists a ProspectResearchProfile per created Prospect, in the same
 * execution — no extra tool/model call.
 */
export const prospectResearcherService = {
  async run(params: RunProspectResearcherParams): Promise<RunOutcome<ProspectResearcherResult>> {
    const icpProfile = await icpProfileRepository.findById(params.icpProfileId);
    if (!icpProfile) throw new NotFoundError("IcpProfile", params.icpProfileId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { icpProfileId: params.icpProfileId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const query = `${icpProfile.role} ${icpProfile.industry} ${icpProfile.problemExposure}`.slice(0, SEARCH_QUERY_MAX_LENGTH);
        const toolResult = (await handle.callTool(PROSPECT_SEARCH_TOOL_ID, { query, maxResults: SEARCH_RESULTS_PER_QUERY })) as SearchToolOutput;
        const results: RawSearchResult[] = toolResult.results.map((r) => ({ title: r.title, content: r.content, url: r.url }));

        handle.step();
        const { value: extraction } = await completeWithValidation(handle.callModel, prospectExtractionSchema, {
          systemPrompt: PROSPECT_RESEARCHER_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildResearchPrompt(icpProfile, results) }],
          devFixtureResponse: buildDevProspectFixture(icpProfile.role, results),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const existing = await prospectRepository.listForOpportunity(icpProfile.opportunityId);
        const knownSourceUrls = new Set(existing.map((p) => p.sourceUrl));

        // researchToolMode is the exact same flag the M3 source adapters key off of — "live" means a real
        // external source was actually queried; "development" (the default, and this environment's current
        // state) means the tool returned simulated results, so this candidate's provenance is DEV_FIXTURE,
        // never silently REAL (Phase 2's own non-negotiable).
        const reality = config.researchToolMode === "live" ? "REAL" : "DEV_FIXTURE";
        const provenanceNote =
          reality === "REAL"
            ? `Collected via the live "${PROSPECT_SEARCH_TOOL_ID}" research tool (RESEARCH_TOOL_MODE=live).`
            : `Development-fixture research tool output (RESEARCH_TOOL_MODE=development) — no live source was queried.`;
        buildRealWorldTag({ reality, experimentId: null, note: provenanceNote }); // validates only — throws if REAL/HUMAN_ACTION ever got an empty note.

        const created: Prospect[] = [];
        for (const candidate of extraction.prospects) {
          const result = results[candidate.sourceIndex];
          // Out-of-range index or no real URL behind it — never trust a model-supplied index/URL directly (§7); silently drop rather than fabricate provenance.
          if (!result || result.url === null) continue;
          if (knownSourceUrls.has(result.url)) continue;

          const prospect = await prospectService.create({
            opportunityId: icpProfile.opportunityId,
            icpProfileId: icpProfile.id,
            organization: candidate.organization,
            role: candidate.role,
            publicContactChannel: candidate.publicContactChannel,
            source: PROSPECT_SEARCH_TOOL_ID,
            sourceUrl: result.url,
            discoveredByAgentId: params.agentId,
            actorType: "AGENT",
            actorId: params.agentId,
          });
          created.push(prospect);
          knownSourceUrls.add(result.url);

          await persistResearchProfile(prospect.id, candidate, params.agentId, reality, provenanceNote);
        }

        return { prospects: created };
      },
      PROSPECT_RESEARCHER_BUDGET,
    );
  },
};

async function persistResearchProfile(
  prospectId: string,
  candidate: ProspectExtractionItem,
  agentId: string,
  reality: string,
  provenanceNote: string,
): Promise<void> {
  const verifiedContactType = verifyContactType({
    claimedType: candidate.contactType,
    contactSource: candidate.contactSource,
    publicContactChannel: candidate.publicContactChannel,
  });
  const allSignals = [...candidate.workflowSignals, ...candidate.painHypotheses];
  const confidence = capProspectCandidateConfidence(candidate.confidence, allSignals);

  await prospectResearchProfileRepository.create({
    prospectId,
    businessName: candidate.organization,
    industry: candidate.industry,
    location: candidate.location,
    website: candidate.website,
    contactType: verifiedContactType,
    contactSource: candidate.contactSource,
    decisionMaker: candidate.decisionMaker,
    workflowSignals: toJsonString(candidate.workflowSignals),
    painHypotheses: toJsonString(candidate.painHypotheses),
    confidence,
    reality,
    provenanceNote,
    createdByAgentId: agentId,
  });
}

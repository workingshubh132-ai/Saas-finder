import { z } from "zod";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { agentRuntimeService, type RunOutcome } from "./agent-runtime.service.js";
import { evidenceService } from "./evidence.service.js";
import { completeWithValidation } from "./model-output.js";
import { opportunityService } from "./opportunity.service.js";
import type { OpportunityScoreDimensions } from "./opportunity-scorer.js";

const RESEARCH_TOOL_ID = "hn_search";
const MODEL_MAX_OUTPUT_TOKENS = 1024;

const researchFindingSchema = z.object({
  claim: z.string().min(1),
  reasoning: z.string().min(1),
  sourceReference: z.string().min(1),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
});
export type ResearchFinding = z.infer<typeof researchFindingSchema>;

const researchPlanSchema = z.object({ queries: z.array(z.string().min(1)).min(1).max(3) });
type ResearchPlan = z.infer<typeof researchPlanSchema>;

const researchSynthesisSchema = z.object({
  title: z.string().min(1).max(200),
  problem: z.string().min(1),
  targetCustomer: z.string().min(1),
  findings: z.array(researchFindingSchema).min(1),
});
export type ResearchSynthesis = z.infer<typeof researchSynthesisSchema>;

const PLAN_SYSTEM_PROMPT =
  "You are the Research Agent for VentureForge, an AI-native company that discovers and validates SaaS opportunities " +
  "(see CONSTITUTION.md). Given a research objective, produce 1-3 concise, concrete search queries that would surface " +
  'real evidence of the underlying problem. Respond with ONLY JSON matching: {"queries": string[]}';

const SYNTHESIZE_SYSTEM_PROMPT =
  "You are the Research Agent for VentureForge. Given a research objective and raw search results, extract a small " +
  "number of concrete findings. Each finding must cite a specific claim, your reasoning, a sourceReference URL taken " +
  "from the actual results (never invent one), a confidence (0-1) reflecting how well-supported the claim is, and a " +
  "relevance (0-1) to the objective. You do not decide whether the opportunity is validated — that is not your call. " +
  'Respond with ONLY JSON matching: {"title": string, "problem": string, "targetCustomer": string, "findings": ' +
  '[{"claim": string, "reasoning": string, "sourceReference": string, "confidence": number, "relevance": number}]}';

export interface RunResearchAgentParams {
  agentId: string;
  objective: string;
  taskId?: string | null;
  startedBy: AuthenticatedActor;
}

export interface ResearchAgentResult {
  opportunityId: string;
  synthesis: ResearchSynthesis;
}

/**
 * The Research Agent (M2 brief Parts 10-13): "Find and analyze
 * evidence for potential SaaS opportunities." A fixed, bounded
 * pipeline — Plan -> Tool -> Synthesize -> Process — driven through
 * agentRuntimeService, never a dynamic/open-ended loop. See
 * docs/AGENT_RUNTIME.md.
 *
 * It creates an Opportunity, Evidence, and a score — it never sets
 * status past DISCOVERED or advances the validation level; that
 * remains for opportunityService.setValidationLevel (human/Chairman-
 * gated per docs/VALIDATION_POLICY.md) and the approval flow.
 */
export const researchAgentService = {
  async run(params: RunResearchAgentParams): Promise<RunOutcome<ResearchAgentResult>> {
    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: params.taskId,
      input: { objective: params.objective },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(execution.id, async (handle) => {
      // 1. PLAN
      handle.step();
      const { value: plan } = await completeWithValidation(handle.callModel, researchPlanSchema, {
        systemPrompt: PLAN_SYSTEM_PROMPT,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: `Research objective: ${params.objective}` }],
        devFixtureResponse: buildDevPlanFixture(params.objective),
      });

      // 2. TOOL — one bounded call per planned query.
      const toolResults: unknown[] = [];
      for (const query of plan.queries) {
        handle.step();
        toolResults.push(await handle.callTool(RESEARCH_TOOL_ID, { query, maxResults: 5 }));
      }

      // 3. SYNTHESIZE
      handle.step();
      const { value: synthesis } = await completeWithValidation(handle.callModel, researchSynthesisSchema, {
        systemPrompt: SYNTHESIZE_SYSTEM_PROMPT,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "user",
            content: `Research objective: ${params.objective}\n\nRaw search results (JSON):\n${JSON.stringify(toolResults)}`,
          },
        ],
        devFixtureResponse: buildDevSynthesisFixture(params.objective, toolResults),
      });

      // 4. PROCESS_RESULT — explicit finding -> evidence -> opportunity
      // candidate transformation (M2 brief Part 13). Nothing here lets
      // model output directly become a "validated" opportunity.
      await handle.transition("PROCESSING_RESULT");
      handle.step();

      const opportunity = await opportunityService.createOpportunity({
        title: synthesis.title,
        problem: synthesis.problem,
        targetCustomer: synthesis.targetCustomer,
        description: synthesis.findings.map((finding) => finding.claim).join(" "),
        discoveredBy: { actorType: "AGENT", actorId: params.agentId },
      });

      for (const finding of synthesis.findings) {
        const evidence = await evidenceService.collectEvidence({
          claim: finding.claim,
          source: "Hacker News Search",
          sourceType: "WEB",
          sourceReference: finding.sourceReference,
          collectedByAgentId: params.agentId,
          reliability: finding.confidence >= 0.6 ? "MEDIUM" : "LOW",
          confidence: finding.confidence,
          metadata: { reasoning: finding.reasoning, relevance: finding.relevance },
        });
        await opportunityService.attachEvidence({
          opportunityId: opportunity.id,
          evidenceId: evidence.id,
          actor: { actorType: "AGENT", actorId: params.agentId },
        });
      }

      await opportunityService.scoreOpportunity({
        opportunityId: opportunity.id,
        dimensions: deriveScoreDimensions(synthesis.findings),
        scoredBy: params.agentId,
      });

      return { opportunityId: opportunity.id, synthesis };
    });
  },
};

function buildDevPlanFixture(objective: string): ResearchPlan {
  return { queries: [objective, `${objective} pain points`, `${objective} pricing`].slice(0, 3) };
}

interface DevSearchResultShape {
  results?: Array<{ title: string; url: string | null }>;
}

function buildDevSynthesisFixture(objective: string, toolResults: unknown[]): ResearchSynthesis {
  const hits = toolResults.flatMap((result) => (result as DevSearchResultShape).results ?? []);
  const findings: ResearchFinding[] = hits.slice(0, 3).map((hit, index) => ({
    claim: `[DEV FIXTURE] "${hit.title}" suggests recurring demand related to: ${objective}`,
    reasoning: "[DEV FIXTURE] Derived deterministically from a fixture search result title — no real model reasoning was performed.",
    sourceReference: hit.url ?? `https://dev-fixture.local/${index}`,
    confidence: 0.5,
    relevance: 0.6,
  }));

  return {
    title: `[DEV FIXTURE] Opportunity derived from: ${objective}`.slice(0, 200),
    problem: `[DEV FIXTURE] Problem synthesized (no real model call) from objective: ${objective}`,
    targetCustomer: "[DEV FIXTURE] Placeholder target customer — no real synthesis was performed.",
    findings:
      findings.length > 0
        ? findings
        : [
            {
              claim: `[DEV FIXTURE] Placeholder finding for objective: ${objective}`,
              reasoning: "[DEV FIXTURE] No tool results were available to derive a finding from.",
              sourceReference: "https://dev-fixture.local/none",
              confidence: 0.3,
              relevance: 0.3,
            },
          ],
  };
}

/**
 * Deterministic placeholder (same spirit as M1's DeterministicOpportunityScorer,
 * docs/DECISIONS.md #4): a web search alone speaks directly to pain,
 * demand, and evidence quality, so those track the findings' actual
 * confidence/relevance. Dimensions it cannot speak to (willingness to
 * pay, reachability, retention, differentiation, buildability,
 * economics) get conservative, explicit neutral defaults rather than
 * an invented number.
 */
function deriveScoreDimensions(findings: ResearchFinding[]): OpportunityScoreDimensions {
  const avgConfidence = findings.reduce((sum, finding) => sum + finding.confidence, 0) / findings.length;
  const avgRelevance = findings.reduce((sum, finding) => sum + finding.relevance, 0) / findings.length;

  return {
    pain: avgRelevance,
    demand: avgRelevance,
    willingnessToPay: avgConfidence * 0.6,
    reachability: 0.5,
    retention: 0.5,
    differentiation: 0.4,
    buildability: 0.6,
    economics: 0.5,
    risk: 1 - avgConfidence,
    evidenceQuality: avgConfidence,
  };
}

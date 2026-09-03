import { z } from "zod";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { ToolError } from "../domain/shared/errors.js";
import type { SearchToolOutput } from "../tools/source-search.tool.js";
import { toolRegistry } from "../tools/tool-registry.js";
import { agentRuntimeService, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";
import { signalService } from "./signal.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 512;
const RESULTS_PER_QUERY = 5;

const researchPlanSchema = z.object({ queries: z.array(z.string().min(1)).min(1).max(3) });
type ResearchPlan = z.infer<typeof researchPlanSchema>;

const PLAN_SYSTEM_PROMPT =
  "You are the Research Agent for VentureForge, an AI-native company that discovers and validates SaaS opportunities " +
  "(see CONSTITUTION.md). Given a research objective, produce 1-3 concise, concrete search queries that would surface " +
  'real public signal about the underlying problem. Respond with ONLY JSON matching: {"queries": string[]}';

export interface RunResearchAgentParams {
  agentId: string;
  objective: string;
  taskId?: string | null;
  startedBy: AuthenticatedActor;
}

export interface ResearchAgentResult {
  signalIds: string[];
  signalsIngested: number;
  signalsDuplicate: number;
}

/**
 * The Research Agent (M2 brief Parts 10-13; M3 brief Part 1, Part 24).
 * Bounded PLAN -> TOOL -> INGEST pipeline through agentRuntimeService,
 * never a dynamic/open-ended loop — see docs/AGENT_RUNTIME.md.
 *
 * M3 CHANGE (docs/M3_ARCHITECTURE_PROPOSAL.md §1, §9): this agent's
 * job shrank to SIGNAL COLLECTION only. It no longer synthesizes
 * findings or creates Evidence/Opportunity directly — that would let
 * a single signal automatically become an opportunity, exactly what
 * M3 brief Part 3 forbids. Every raw source result becomes a
 * normalized Signal via signalService.ingest() (dedup, quality
 * scoring); turning signals into a Problem, then Evidence, then an
 * Opportunity, is now the job of signalClusteringService,
 * problemAnalystService, and opportunityAnalystService downstream. The
 * old SYNTHESIZE model call is gone entirely — that reasoning now
 * happens once, better-informed, at the Problem Analyst stage over a
 * whole cluster rather than one run's raw results (a real
 * simplification, not a silent capability loss).
 *
 * Rounds queries across every registered source tool (never every
 * source x every query — Part 45's N x M x K warning) so
 * `toolCallCount` stays == `queries.length`, within the unchanged
 * default budget, while still drawing on more than one source over
 * the system's history.
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
      const sourceIds = toolRegistry
        .list()
        .filter((tool) => tool.category === "RESEARCH_SOURCE")
        .map((tool) => tool.id);
      if (sourceIds.length === 0) {
        throw new ToolError("No research sources are registered — call registerDefaultTools() before running the Research Agent.");
      }

      // 1. PLAN
      handle.step();
      const { value: plan } = await completeWithValidation(handle.callModel, researchPlanSchema, {
        systemPrompt: PLAN_SYSTEM_PROMPT,
        maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: `Research objective: ${params.objective}` }],
        devFixtureResponse: buildDevPlanFixture(params.objective),
      });

      // 2. TOOL — one bounded call per planned query, round-robined
      // across every registered source.
      const collected: Array<{ sourceId: string; results: SearchToolOutput["results"] }> = [];
      for (let index = 0; index < plan.queries.length; index += 1) {
        handle.step();
        const sourceId = sourceIds[index % sourceIds.length] as string;
        const output = (await handle.callTool(sourceId, { query: plan.queries[index], maxResults: RESULTS_PER_QUERY })) as SearchToolOutput;
        collected.push({ sourceId, results: output.results });
      }

      // 3. PROCESS_RESULT — every raw result becomes a normalized Signal.
      await handle.transition("PROCESSING_RESULT");
      handle.step();

      const signalIds: string[] = [];
      let duplicateCount = 0;
      for (const batch of collected) {
        for (const raw of batch.results) {
          const signal = await signalService.ingest({
            source: batch.sourceId,
            sourceType: "WEB",
            raw,
            collectedByAgentId: params.agentId,
          });
          signalIds.push(signal.id);
          if (signal.status === "DUPLICATE") duplicateCount += 1;
        }
      }

      return { signalIds, signalsIngested: signalIds.length, signalsDuplicate: duplicateCount };
    });
  },
};

function buildDevPlanFixture(objective: string): ResearchPlan {
  return { queries: [objective, `${objective} pain points`, `${objective} pricing`].slice(0, 3) };
}

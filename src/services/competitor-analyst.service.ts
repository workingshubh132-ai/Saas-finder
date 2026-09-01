import type { CompetitorObservation } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { COMPETITOR_OBSERVATION_TYPES } from "../domain/competitor/competitor.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { competitorRepository, type ObservationWithCompetitor } from "../db/repositories/competitor.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";
import { eventBus } from "./event-bus.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;
/** One bounded search + one extraction call — no planning call needed,
 *  the query is built deterministically from the Problem
 *  (docs/M3_ARCHITECTURE_PROPOSAL.md §14). */
const COMPETITOR_ANALYST_BUDGET: Partial<ExecutionBudget> = { maxSteps: 3, maxToolCalls: 1, maxModelCalls: 1, maxRetries: 1, maxDurationMs: 15_000 };
/** Hacker News is the more general "what are people discussing/using"
 *  source; Stack Exchange's Q&A framing is less suited to "what tools
 *  exist for this" queries — see docs/SOURCE_ADAPTERS.md. */
const COMPETITOR_SEARCH_TOOL_ID = "hacker_news";

const competitorExtractionSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string().min(1),
      url: z.string().nullable(),
      observations: z
        .array(
          z.object({
            type: z.enum(COMPETITOR_OBSERVATION_TYPES),
            detail: z.string().min(1),
            sourceReference: z.string().nullable(),
          }),
        )
        .min(1),
    }),
  ),
});
type CompetitorExtraction = z.infer<typeof competitorExtractionSchema>;

const COMPETITOR_ANALYST_SYSTEM_PROMPT =
  "You are the Competitor Analyst for VentureForge (M3 brief Part 17). Given a problem statement and raw search " +
  "results, identify any real competing products/tools actually named in the results — never invent a competitor " +
  "that isn't there. For each, record only observations (pricing/positioning/reviews/strengths/weaknesses/market " +
  "maturity) that the search results actually support; if a result doesn't mention pricing, do not report a price. " +
  'It is a fully valid answer to find zero competitors — "no competitors found" is real information, not a failure. ' +
  'Respond with ONLY JSON matching: {"competitors": [{"name": string, "url": string|null, "observations": ' +
  '[{"type": "PRICING"|"POSITIONING"|"REVIEW"|"STRENGTH"|"WEAKNESS"|"MARKET_MATURITY", "detail": string, "sourceReference": string|null}]}]}';

export interface RunCompetitorAnalystParams {
  agentId: string;
  problemId: string;
  startedBy: AuthenticatedActor;
}

export interface CompetitorAnalystResult {
  observations: ObservationWithCompetitor[];
}

/**
 * The Competitor Analyst (M3 brief Part 17, 24): the one new agent
 * that makes a tool call, so — unlike Problem/Market/Opportunity
 * Analyst — its search genuinely passes through Guardian
 * (`authorizationService.authorize`, via `handle.callTool`) exactly
 * like the Research Agent's does (docs/AGENT_RUNTIME.md).
 */
export const competitorAnalystService = {
  async run(params: RunCompetitorAnalystParams): Promise<RunOutcome<CompetitorAnalystResult>> {
    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { problemId: params.problemId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        const problem = await problemRepository.findById(params.problemId);
        if (!problem) throw new NotFoundError("Problem", params.problemId);

        handle.step();
        const query = `${problem.workflow} alternative tool`;
        const toolResult = await handle.callTool(COMPETITOR_SEARCH_TOOL_ID, { query, maxResults: 5 });

        handle.step();
        const { value: extraction } = await completeWithValidation(handle.callModel, competitorExtractionSchema, {
          systemPrompt: COMPETITOR_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: `Problem: ${problem.statement}\nWorkflow: ${problem.workflow}\n\nRaw search results (JSON):\n${JSON.stringify(toolResult)}`,
            },
          ],
          devFixtureResponse: buildDevCompetitorFixture(problem.workflow, toolResult),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const observations: CompetitorObservation[] = [];
        for (const competitorInput of extraction.competitors) {
          const competitor = await competitorRepository.findOrCreateByName(competitorInput.name, competitorInput.url);
          for (const observationInput of competitorInput.observations) {
            observations.push(
              await competitorRepository.addObservation({
                competitorId: competitor.id,
                problemId: problem.id,
                type: observationInput.type,
                detail: observationInput.detail,
                sourceReference: observationInput.sourceReference,
              }),
            );
          }
        }

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "COMPETITOR_ANALYSIS_COMPLETED",
          resourceType: "PROBLEM",
          resourceId: problem.id,
          result: "SUCCESS",
          metadata: { competitorCount: extraction.competitors.length, observationCount: observations.length },
        });
        await eventBus.publish({
          type: "COMPETITOR_ANALYSIS_COMPLETED",
          payload: { problemId: problem.id, competitorCount: extraction.competitors.length },
        });

        const withCompetitor = await competitorRepository.listObservationsForProblem(problem.id);
        return { observations: withCompetitor };
      },
      COMPETITOR_ANALYST_BUDGET,
    );
  },
};

interface DevSearchResultShape {
  results?: Array<{ title: string; url: string | null }>;
}

/**
 * DEVELOPMENT ONLY — derived from the actual tool result titles, never
 * a static stub. Never claims pricing (dev-fixture search results have
 * none to claim) — proving the "don't fabricate pricing" rule holds
 * even in fixture mode.
 */
function buildDevCompetitorFixture(workflow: string, toolResult: unknown): CompetitorExtraction {
  const hits = (toolResult as DevSearchResultShape).results ?? [];
  if (hits.length === 0) return { competitors: [] };

  const first = hits[0];
  return {
    competitors: [
      {
        name: `[DEV FIXTURE] Existing tool for: ${workflow}`.slice(0, 100),
        url: first?.url ?? null,
        observations: [
          {
            type: "POSITIONING",
            detail: `[DEV FIXTURE] Positioning inferred from "${first?.title ?? "a search result"}" — no real model reasoning was performed.`,
            sourceReference: first?.url ?? null,
          },
        ],
      },
    ],
  };
}

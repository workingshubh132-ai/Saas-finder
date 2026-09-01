import { z } from "zod";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;
const MARKET_ANALYST_BUDGET: Partial<ExecutionBudget> = { maxSteps: 2, maxToolCalls: 0, maxModelCalls: 1, maxRetries: 1, maxDurationMs: 15_000 };

const marketAnalysisSchema = z.object({
  /** Empty is valid — "no willingness-to-pay signal found" is real information (M3 brief Part 18). */
  wtpSignals: z.array(z.string().min(1)),
  marketTiming: z.string().min(1),
  marketSizeQualitative: z.string().min(1),
});
export type MarketAnalysisResult = z.infer<typeof marketAnalysisSchema>;

const MARKET_ANALYST_SYSTEM_PROMPT =
  "You are the Market Analyst for VentureForge (M3 brief Part 18). Given a problem and its supporting evidence, " +
  "identify concrete willingness-to-pay SIGNALS actually present — existing paid tools referenced, manual/outsourcing " +
  "cost mentioned, revenue loss described, explicit budget or pricing discussion — never invent one. Separate PAIN " +
  "from pain someone will pay to remove: reporting zero WTP signals when none exist is the correct, honest answer, " +
  "not a failure. Also give a brief, evidence-grounded read on market timing and qualitative market size — 'unclear' " +
  'is an acceptable answer when the evidence does not support more. Respond with ONLY JSON matching: {"wtpSignals": ' +
  'string[], "marketTiming": string, "marketSizeQualitative": string}';

export interface RunMarketAnalystParams {
  agentId: string;
  problemId: string;
  startedBy: AuthenticatedActor;
}

/**
 * The Market Analyst (M3 brief Part 18, 24): WTP signals + a market
 * timing/size read, reasoning-only (no tool calls) over a Problem's
 * own fields — still runs through agentRuntimeService for uniform
 * telemetry (docs/M3_ARCHITECTURE_PROPOSAL.md §14). Its output is not
 * separately persisted; the orchestrating research cycle threads it
 * directly into the Opportunity Analyst, and its own `AgentExecution.output`
 * row is the durable record of what it found.
 */
export const marketAnalystService = {
  async run(params: RunMarketAnalystParams): Promise<RunOutcome<MarketAnalysisResult>> {
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
        const { value } = await completeWithValidation(handle.callModel, marketAnalysisSchema, {
          systemPrompt: MARKET_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content:
                `Problem: ${problem.statement}\nCurrent solution: ${problem.currentSolution}\n` +
                `Dissatisfaction: ${problem.dissatisfaction}\nWillingness-to-pay signal already noted: ${problem.willingnessToPaySignal}`,
            },
          ],
          devFixtureResponse: buildDevMarketFixture(problem.willingnessToPaySignal),
        });

        return value;
      },
      MARKET_ANALYST_BUDGET,
    );
  },
};

/** DEVELOPMENT ONLY — derived from the Problem's own already-extracted
 *  willingnessToPaySignal field, never a static stub. */
function buildDevMarketFixture(existingSignal: string): MarketAnalysisResult {
  const hasRealSignal = !existingSignal.toLowerCase().includes("no explicit") && !existingSignal.toLowerCase().includes("[dev fixture] no");
  return {
    wtpSignals: hasRealSignal ? [`[DEV FIXTURE] Derived from the problem's own noted signal: ${existingSignal}`] : [],
    marketTiming: "[DEV FIXTURE] No real model reasoning was performed — market timing unassessed.",
    marketSizeQualitative: "[DEV FIXTURE] Unclear — insufficient real analysis in development mode.",
  };
}

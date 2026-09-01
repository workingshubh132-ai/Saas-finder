import type { Problem, Signal, SignalCluster } from "@prisma/client";
import { z } from "zod";
import { signalClusterRepository } from "../db/repositories/signal-cluster.repository.js";
import { NotFoundError } from "../domain/shared/errors.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";
import { problemService } from "./problem.service.js";
import { signalRepository } from "../db/repositories/signal.repository.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;
/** No tool calls — this agent only reasons over signals already
 *  collected by the Research Agent (docs/M3_ARCHITECTURE_PROPOSAL.md §14). */
const PROBLEM_ANALYST_BUDGET: Partial<ExecutionBudget> = { maxSteps: 2, maxToolCalls: 0, maxModelCalls: 1, maxRetries: 1, maxDurationMs: 15_000 };

/** A cluster needs at least this much independent corroboration and
 *  extracted confidence before its Problem is worth promoting toward
 *  an Opportunity (docs/M3_ARCHITECTURE_PROPOSAL.md §7, Part 43). */
const MIN_INDEPENDENT_SOURCES_TO_PROMOTE = 2;
const MIN_CONFIDENCE_TO_PROMOTE = 0.3;

const problemExtractionSchema = z.object({
  statement: z.string().min(1),
  customerSegment: z.string().min(1),
  workflow: z.string().min(1),
  pain: z.string().min(1),
  frequency: z.string().min(1),
  currentSolution: z.string().min(1),
  dissatisfaction: z.string().min(1),
  urgency: z.string().min(1),
  willingnessToPaySignal: z.string().min(1),
  evidenceCount: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});
type ProblemExtraction = z.infer<typeof problemExtractionSchema>;

const PROBLEM_ANALYST_SYSTEM_PROMPT =
  "You are the Problem Analyst for VentureForge (see CONSTITUTION.md, M3 brief Part 11). Given a cluster of related " +
  "public signals, extract ONE structured recurring problem — or say the evidence doesn't support one. Critically: " +
  '"I don\'t like this product" is NOT a Problem. "A recurring, expensive workflow problem affecting many customers" ' +
  "IS a Problem. Only extract a Problem if the signals actually describe a real workflow, its frequency, and who is " +
  "affected — do not invent detail the signals don't support. evidenceCount must be the number of signals that " +
  "genuinely support this problem, never inflated above what you were given. " +
  'Respond with ONLY JSON matching: {"statement": string, "customerSegment": string, "workflow": string, "pain": ' +
  'string, "frequency": string, "currentSolution": string, "dissatisfaction": string, "urgency": string, ' +
  '"willingnessToPaySignal": string, "evidenceCount": number, "confidence": number}';

export interface RunProblemAnalystParams {
  agentId: string;
  clusterId: string;
  startedBy: AuthenticatedActor;
}

export interface ProblemAnalystResult {
  problem: Problem;
}

/**
 * The Problem Analyst (M3 brief Part 11, 24): cluster -> structured
 * Problem, via agentRuntimeService like every other agent (uniform
 * AgentExecution telemetry/budget/audit — docs/M3_ARCHITECTURE_PROPOSAL.md
 * §14) even though it makes zero tool calls, only one bounded model
 * call. Never promotes its own output past what the cluster's real
 * stats support — INSUFFICIENT_EVIDENCE is a normal, successful
 * outcome (M3 brief Part 43), not an error.
 */
export const problemAnalystService = {
  async run(params: RunProblemAnalystParams): Promise<RunOutcome<ProblemAnalystResult>> {
    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { clusterId: params.clusterId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        const cluster = await signalClusterRepository.findById(params.clusterId);
        if (!cluster) throw new NotFoundError("SignalCluster", params.clusterId);
        const signals = await signalRepository.listByCluster(cluster.id);
        const clusteredSignals = signals.filter((signal) => signal.status === "CLUSTERED");

        handle.step();
        const { value: extraction } = await completeWithValidation(handle.callModel, problemExtractionSchema, {
          systemPrompt: PROBLEM_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildClusterPrompt(cluster, clusteredSignals) }],
          devFixtureResponse: buildDevProblemFixture(cluster, clusteredSignals),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust the model's own evidenceCount beyond what
        // actually exists (docs/M3_ARCHITECTURE_PROPOSAL.md §7).
        const evidenceCount = Math.min(extraction.evidenceCount, clusteredSignals.length);
        const meetsBar = cluster.independentSourceCount >= MIN_INDEPENDENT_SOURCES_TO_PROMOTE && extraction.confidence >= MIN_CONFIDENCE_TO_PROMOTE;

        const problem = await problemService.create({
          ...extraction,
          clusterId: cluster.id,
          evidenceCount,
          status: meetsBar ? "CANDIDATE" : "INSUFFICIENT_EVIDENCE",
          collectedByAgentId: params.agentId,
        });

        return { problem };
      },
      PROBLEM_ANALYST_BUDGET,
    );
  },
};

function buildClusterPrompt(cluster: SignalCluster, signals: Signal[]): string {
  const lines = signals.map(
    (signal, index) =>
      `${index + 1}. [${signal.sourceType}, quality=${signal.qualityScore.toFixed(2)}] ${signal.title} — ${signal.content}`,
  );
  return [
    `Cluster: ${cluster.name}`,
    `Independent source count: ${cluster.independentSourceCount}`,
    `Cluster confidence so far: ${cluster.confidence.toFixed(2)}`,
    "",
    `Signals (${signals.length}):`,
    ...(lines.length > 0 ? lines : ["(none)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — a deterministic function of the real cluster
 * data, never a static stub (same honesty bar as every other M2/M3
 * dev fixture). A thin cluster (few signals, low independence)
 * produces a low-confidence extraction that will correctly fail the
 * promotion bar above — proving INSUFFICIENT_EVIDENCE is reachable
 * even in dev mode.
 */
function buildDevProblemFixture(cluster: SignalCluster, signals: Signal[]): ProblemExtraction {
  const avgQuality = signals.length > 0 ? signals.reduce((sum, signal) => sum + signal.qualityScore, 0) / signals.length : 0;
  const confidence = Math.min(0.9, 0.2 + cluster.independentSourceCount * 0.15 + avgQuality * 0.2);

  return {
    statement: `[DEV FIXTURE] Recurring problem inferred from cluster "${cluster.name}" (no real model reasoning was performed).`,
    customerSegment: "[DEV FIXTURE] Small business teams referenced across the clustered signals.",
    workflow: "[DEV FIXTURE] The workflow implied by the clustered signals' content.",
    pain: "[DEV FIXTURE] The recurring friction described across the clustered signals.",
    frequency: signals.length >= 3 ? "[DEV FIXTURE] Appears repeatedly across independent signals." : "[DEV FIXTURE] Observed once so far — frequency unconfirmed.",
    currentSolution: "[DEV FIXTURE] No dedicated tool identified in the signals gathered.",
    dissatisfaction: "[DEV FIXTURE] Dissatisfaction level not independently verified.",
    urgency: "[DEV FIXTURE] Urgency not independently verified.",
    willingnessToPaySignal: "[DEV FIXTURE] No explicit willingness-to-pay signal found in the gathered signals.",
    evidenceCount: signals.length,
    confidence,
  };
}

import type { Anomaly } from "@prisma/client";
import { z } from "zod";
import { anomalyRepository } from "../db/repositories/anomaly.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { RETENTION_WINDOWS } from "../domain/product-intelligence/retention.js";
import { isComputed } from "../domain/shared/metric-result.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { metricEngineService } from "./metric-engine.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/** Zero tool calls (docs/M8_ARCHITECTURE_PROPOSAL.md §3) — reasons over already-computed metrics/anomalies, never invents new numbers itself. */
export const PRODUCT_INTELLIGENCE_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const productIntelligenceOutputSchema = z.object({
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string().min(1)),
  bottlenecks: z.array(z.string().min(1)),
  opportunities: z.array(z.string().min(1)),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ProductIntelligenceOutput = z.infer<typeof productIntelligenceOutputSchema>;

export interface ProductIntelligenceSummary {
  activationRate: number | null;
  activationSampleInsufficient: boolean;
  retentionByWindow: Partial<Record<string, number>>;
  retentionInsufficientWindows: string[];
  anomalies: readonly Anomaly[];
}

const PRODUCT_INTELLIGENCE_SYSTEM_PROMPT =
  "You are the Product Intelligence Agent for VentureForge (docs/M8_ARCHITECTURE_PROPOSAL.md §3). Your job: " +
  "understand how users actually interact with a LIVE product, using only the already-computed activation/retention/" +
  "anomaly data given to you. You have no tools and cannot query anything yourself. Identify strengths, weaknesses, " +
  "bottlenecks, and opportunities — every item MUST reference a specific real number given below (a rate, a window, " +
  "an anomaly's own z-score); never state a strength or weakness with no corresponding data point. If data is " +
  "insufficient for a window, say so honestly rather than guessing. " +
  'Respond with ONLY JSON matching: {"strengths": string[], "weaknesses": string[], "bottlenecks": string[], ' +
  '"opportunities": string[], "reasoning": string, "confidence": number}';

function buildProductIntelligencePrompt(summary: ProductIntelligenceSummary): string {
  const retentionLines = Object.entries(summary.retentionByWindow).map(([window, rate]) => `- ${window}: ${((rate ?? 0) * 100).toFixed(1)}%`);
  const anomalyLines = summary.anomalies.map((a) => `- [${a.metricType}] ${a.direction} — z=${a.zScore.toFixed(2)}: ${a.reason}`);
  return [
    summary.activationSampleInsufficient
      ? "Activation rate: INSUFFICIENT_DATA (too few signups so far)."
      : `Activation rate: ${((summary.activationRate ?? 0) * 100).toFixed(1)}%`,
    `Retention:`,
    ...(retentionLines.length > 0 ? retentionLines : ["(no window has enough data yet)"]),
    summary.retentionInsufficientWindows.length > 0 ? `Windows with insufficient data: ${summary.retentionInsufficientWindows.join(", ")}` : "",
    `Recent anomalies (${summary.anomalies.length}):`,
    ...(anomalyLines.length > 0 ? anomalyLines : ["(none detected)"]),
  ]
    .filter(Boolean)
    .join("\n");
}

/** DEVELOPMENT ONLY — deterministic, derived from the product's own real activation/retention/anomaly data. */
function buildDevProductIntelligenceFixture(summary: ProductIntelligenceSummary): ProductIntelligenceOutput {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const bottlenecks: string[] = [];
  const opportunities: string[] = [];

  if (!summary.activationSampleInsufficient && (summary.activationRate ?? 0) >= 0.4) {
    strengths.push(`[DEV FIXTURE] Activation rate of ${((summary.activationRate ?? 0) * 100).toFixed(1)}% indicates the core workflow is reachable for a real share of signups.`);
  } else if (!summary.activationSampleInsufficient) {
    bottlenecks.push(`[DEV FIXTURE] Activation rate of ${((summary.activationRate ?? 0) * 100).toFixed(1)}% is low — most signups never reach the product's own defined activation event.`);
  }

  for (const [window, rate] of Object.entries(summary.retentionByWindow)) {
    if ((rate ?? 0) >= 0.3) strengths.push(`[DEV FIXTURE] ${window} retention of ${((rate ?? 0) * 100).toFixed(1)}% is healthy for this stage.`);
    else weaknesses.push(`[DEV FIXTURE] ${window} retention of ${((rate ?? 0) * 100).toFixed(1)}% is weak — most activated users do not return.`);
  }
  if (summary.retentionInsufficientWindows.length > 0) {
    opportunities.push(`[DEV FIXTURE] ${summary.retentionInsufficientWindows.join(", ")} retention has insufficient data yet — worth tracking as the cohort ages rather than guessing.`);
  }

  for (const a of summary.anomalies) {
    if (a.direction === "DROP") weaknesses.push(`[DEV FIXTURE] ${a.metricType} dropped ${Math.abs(a.zScore).toFixed(2)} standard deviations below baseline — ${a.reason}`);
    else opportunities.push(`[DEV FIXTURE] ${a.metricType} spiked ${a.zScore.toFixed(2)} standard deviations above baseline — worth understanding what drove it. ${a.reason}`);
  }

  if (strengths.length === 0) strengths.push("[DEV FIXTURE] No metric yet clears the bar for a genuine strength — too early or too weak to say.");
  if (weaknesses.length === 0 && bottlenecks.length === 0) weaknesses.push("[DEV FIXTURE] No clear weakness identified from the data available so far.");
  if (opportunities.length === 0) opportunities.push("[DEV FIXTURE] Gather more retention history before recommending a specific product change.");

  return {
    strengths,
    weaknesses,
    bottlenecks,
    opportunities,
    reasoning: "[DEV FIXTURE] Deterministic analysis derived directly from real activation/retention/anomaly rows — no fabricated numbers.",
    confidence: summary.activationSampleInsufficient ? 0.3 : 0.6,
  };
}

export interface RunProductIntelligenceParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export const productIntelligenceService = {
  async run(params: RunProductIntelligenceParams): Promise<RunOutcome<{ output: ProductIntelligenceOutput; summary: ProductIntelligenceSummary }>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "LIVE" && product.status !== "PAUSED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — Product Intelligence only runs against a LIVE (or PAUSED) product.`);
    }

    const now = new Date();
    const activationResult = await metricEngineService.computeAndRecordActivation(product.id, now);
    const retentionByWindow: Partial<Record<string, number>> = {};
    const retentionInsufficientWindows: string[] = [];
    for (const window of RETENTION_WINDOWS) {
      const result = await metricEngineService.computeAndRecordRetention(product.id, window, now);
      if (result.status === "COMPUTED") retentionByWindow[window] = result.retentionRate;
      else retentionInsufficientWindows.push(window);
    }
    const anomalies = await anomalyRepository.listForProduct(product.id);

    const summary: ProductIntelligenceSummary = {
      activationRate: isComputed(activationResult) ? activationResult.value : null,
      activationSampleInsufficient: !isComputed(activationResult),
      retentionByWindow,
      retentionInsufficientWindows,
      anomalies: anomalies.slice(0, 10),
    };

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, productIntelligenceOutputSchema, {
          systemPrompt: PRODUCT_INTELLIGENCE_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildProductIntelligencePrompt(summary) }],
          devFixtureResponse: buildDevProductIntelligenceFixture(summary),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "PRODUCT_INTELLIGENCE_ANALYSIS_COMPLETED",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { activationRate: summary.activationRate, anomalyCount: anomalies.length, confidence: output.confidence },
        });

        return { output, summary };
      },
      PRODUCT_INTELLIGENCE_BUDGET,
    );
  },
};

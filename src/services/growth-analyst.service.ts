import type { GrowthExperimentResult } from "@prisma/client";
import { z } from "zod";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { cohortRepository } from "../db/repositories/cohort.repository.js";
import { growthExperimentRepository } from "../db/repositories/growth-experiment.repository.js";
import { growthExperimentResultRepository } from "../db/repositories/growth-experiment-result.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { computed, insufficientData, isComputed, type MetricResult } from "../domain/shared/metric-result.js";
import { createProductUsageProvider } from "../providers/product-usage-provider-factory.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/** Zero tool calls (docs/M8_ARCHITECTURE_PROPOSAL.md §11). */
export const GROWTH_ANALYST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

export const GROWTH_TRAJECTORIES = ["GROWING", "FLAT", "DECLINING"] as const;
export type GrowthTrajectory = (typeof GROWTH_TRAJECTORIES)[number];

const growthAnalystOutputSchema = z.object({
  trajectory: z.enum(GROWTH_TRAJECTORIES),
  bottleneck: z.string().nullable(),
  promisingChannel: z.string().nullable(),
  summary: z.string().min(1),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type GrowthAnalystOutput = z.infer<typeof growthAnalystOutputSchema>;

const MIN_SIGNUP_SAMPLE = 5;

interface GrowthSummary {
  signupGrowthRate: MetricResult;
  currentPeriodSignups: number;
  priorPeriodSignups: number;
  channelCohortCount: number;
  completedExperimentResults: readonly GrowthExperimentResult[];
}

const GROWTH_ANALYST_SYSTEM_PROMPT =
  "You are the Growth Analyst for VentureForge (docs/M8_ARCHITECTURE_PROPOSAL.md §11). Analyze traffic, signups, " +
  "acquisition channels, and experiment results for a LIVE product, using only the already-computed data given to " +
  "you. You have no tools. Identify growth bottlenecks and any high-performing channel or promising completed " +
  "experiment. If the signup sample is too small to trust a trend, say INSUFFICIENT rather than guessing a " +
  "direction. " +
  'Respond with ONLY JSON matching: {"trajectory": "GROWING"|"FLAT"|"DECLINING", "bottleneck": string|null, ' +
  '"promisingChannel": string|null, "summary": string, "reasoning": string, "confidence": number}';

function buildGrowthAnalystPrompt(summary: GrowthSummary): string {
  const resultLines = summary.completedExperimentResults.map(
    (r) => `- baseline=${r.baselineValue.toFixed(2)} -> experiment=${r.experimentValue.toFixed(2)} (${r.observedChangePct >= 0 ? "+" : ""}${(r.observedChangePct * 100).toFixed(1)}%), confidence=${r.confidence}, decision=${r.decision}`,
  );
  return [
    `Signups this period: ${summary.currentPeriodSignups} (prior period: ${summary.priorPeriodSignups})`,
    `Signup growth rate: ${summary.signupGrowthRate.status === "COMPUTED" ? `${(summary.signupGrowthRate.value * 100).toFixed(1)}%` : summary.signupGrowthRate.status}`,
    `Acquisition-channel cohorts on record: ${summary.channelCohortCount}`,
    `Completed growth experiment results (${resultLines.length}):`,
    ...(resultLines.length > 0 ? resultLines : ["(none completed yet)"]),
  ].join("\n");
}

/** DEVELOPMENT ONLY — deterministic, derived from real signup/experiment data. */
function buildDevGrowthAnalystFixture(summary: GrowthSummary): GrowthAnalystOutput {
  const trajectory: GrowthTrajectory =
    summary.signupGrowthRate.status !== "COMPUTED" ? "FLAT" : summary.signupGrowthRate.value > 0.05 ? "GROWING" : summary.signupGrowthRate.value < -0.05 ? "DECLINING" : "FLAT";

  const bestResult = [...summary.completedExperimentResults].sort((a, b) => b.observedChangePct - a.observedChangePct)[0] ?? null;

  return {
    trajectory,
    bottleneck: trajectory === "DECLINING" ? "[DEV FIXTURE] Signup volume is declining period-over-period — the top-of-funnel itself is the bottleneck, not a downstream step." : null,
    promisingChannel: bestResult && bestResult.observedChangePct > 0 ? `[DEV FIXTURE] The experiment with the strongest observed lift (+${(bestResult.observedChangePct * 100).toFixed(1)}%) is worth scaling.` : null,
    summary: `[DEV FIXTURE] ${summary.currentPeriodSignups} signup(s) this period vs ${summary.priorPeriodSignups} prior — trajectory ${trajectory}.`,
    reasoning: "[DEV FIXTURE] Deterministic trend read directly from real signup counts and completed experiment results.",
    confidence: summary.signupGrowthRate.status === "COMPUTED" ? 0.6 : 0.3,
  };
}

export interface RunGrowthAnalystParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export const growthAnalystService = {
  async run(params: RunGrowthAnalystParams): Promise<RunOutcome<{ output: GrowthAnalystOutput; summary: GrowthSummary }>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "LIVE" && product.status !== "PAUSED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — Growth Analyst only runs against a LIVE (or PAUSED) product.`);
    }

    const now = new Date();
    const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const priorPeriodStart = new Date(periodStart.getTime() - 30 * 24 * 60 * 60 * 1000);

    const usage = createProductUsageProvider();
    const currentSignups = await usage.listEvents({ productId: product.id, eventName: "signup", periodStart, periodEnd: now });
    const priorSignups = await usage.listEvents({ productId: product.id, eventName: "signup", periodStart: priorPeriodStart, periodEnd: periodStart });

    const signupGrowthRate: MetricResult =
      currentSignups.length < MIN_SIGNUP_SAMPLE || priorSignups.length < MIN_SIGNUP_SAMPLE
        ? insufficientData(`Only ${currentSignups.length} current / ${priorSignups.length} prior period signup(s) — need at least ${MIN_SIGNUP_SAMPLE} each.`)
        : computed((currentSignups.length - priorSignups.length) / priorSignups.length);

    if (isComputed(signupGrowthRate)) {
      await businessMetricRepository.create({ productId: product.id, metricType: "CONVERSION_RATE", valueKind: "OBSERVED", value: currentSignups.length, source: "PRODUCT_USAGE_PROVIDER" });
    }

    const cohorts = await cohortRepository.listForProduct(product.id);
    const channelCohortCount = cohorts.filter((c) => c.dimension === "ACQUISITION_CHANNEL").length;

    const experiments = await growthExperimentRepository.listForProduct(product.id);
    const completedExperiments = experiments.filter((e) => e.status === "COMPLETED");
    const resultLists = await Promise.all(completedExperiments.map((e) => growthExperimentResultRepository.listForExperiment(e.id)));
    const completedExperimentResults = resultLists.flat();

    const summary: GrowthSummary = {
      signupGrowthRate,
      currentPeriodSignups: currentSignups.length,
      priorPeriodSignups: priorSignups.length,
      channelCohortCount,
      completedExperimentResults,
    };

    const execution = await agentRuntimeService.startExecution({ agentId: params.agentId, taskId: null, input: { productId: params.productId }, startedBy: params.startedBy });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, growthAnalystOutputSchema, {
          systemPrompt: GROWTH_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildGrowthAnalystPrompt(summary) }],
          devFixtureResponse: buildDevGrowthAnalystFixture(summary),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "GROWTH_ANALYSIS_COMPLETED",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { trajectory: output.trajectory, confidence: output.confidence },
        });

        return { output, summary };
      },
      GROWTH_ANALYST_BUDGET,
    );
  },
};

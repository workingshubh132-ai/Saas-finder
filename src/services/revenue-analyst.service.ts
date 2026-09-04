import { z } from "zod";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeUnitEconomics, type UnitEconomicsResult } from "../domain/revenue-intelligence/unit-economics.js";
import { computed, isComputed, type MetricResult } from "../domain/shared/metric-result.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { createRevenueProvider } from "../providers/revenue-provider-factory.js";
import { metricEngineService } from "./metric-engine.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/** Zero tool calls (docs/M8_ARCHITECTURE_PROPOSAL.md §8) — every number is provenance-checked before this agent ever reasons over it. */
export const REVENUE_ANALYST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const revenueAnalystOutputSchema = z.object({
  summary: z.string().min(1),
  marginIsSustainable: z.boolean(),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type RevenueAnalystOutput = z.infer<typeof revenueAnalystOutputSchema>;

interface RevenueSummary {
  mrr: number;
  arr: number;
  arpu: number | null;
  logoChurn: number | null;
  revenueChurn: number | null;
  estimatedMonthlyCostUsd: number;
  grossMarginPct: number | null;
  unitEconomics: UnitEconomicsResult;
}

const MARGIN_SUSTAINABLE_FLOOR = 0.2;

const REVENUE_ANALYST_SYSTEM_PROMPT =
  "You are the Revenue Analyst for VentureForge (docs/M8_ARCHITECTURE_PROPOSAL.md §8). Analyze MRR, ARR, ARPU, " +
  "churn, and gross margin for a LIVE product, using only the already-computed numbers given to you. You have no " +
  "tools. Every number given carries its own provenance — never restate a CAC or LTV that came back UNKNOWN or " +
  "INSUFFICIENT_DATA as if it were a real figure. State plainly whether the margin is sustainable at the current " +
  `price point (>= ${MARGIN_SUSTAINABLE_FLOOR * 100}% gross margin is the founder-configured floor).` +
  ' Respond with ONLY JSON matching: {"summary": string, "marginIsSustainable": boolean, "reasoning": string, "confidence": number}';

function formatResult(result: MetricResult, unit: string): string {
  if (result.status === "COMPUTED") return `${result.value.toFixed(unit === "%" ? 1 : 2)}${unit}`;
  if (result.status === "UNKNOWN") return "UNKNOWN";
  return `INSUFFICIENT_DATA (${result.reason})`;
}

function buildRevenueAnalystPrompt(summary: RevenueSummary): string {
  return [
    `MRR: $${summary.mrr.toFixed(2)}`,
    `ARR: $${summary.arr.toFixed(2)}`,
    `ARPU: ${summary.arpu === null ? "undefined (no active subscriptions)" : `$${summary.arpu.toFixed(2)}`}`,
    `Logo churn (trailing 30d): ${summary.logoChurn === null ? "insufficient data" : `${(summary.logoChurn * 100).toFixed(1)}%`}`,
    `Revenue churn (trailing 30d): ${summary.revenueChurn === null ? "insufficient data" : `${(summary.revenueChurn * 100).toFixed(1)}%`}`,
    `Estimated monthly operating cost: $${summary.estimatedMonthlyCostUsd.toFixed(2)}`,
    `Gross margin: ${summary.grossMarginPct === null ? "undefined (no revenue yet)" : `${(summary.grossMarginPct * 100).toFixed(1)}%`}`,
    `CAC: ${formatResult(summary.unitEconomics.cac, "$")}`,
    `LTV: ${formatResult(summary.unitEconomics.ltv, "$")}`,
    `LTV:CAC: ${formatResult(summary.unitEconomics.ltvToCac, "x")}`,
  ].join("\n");
}

/** DEVELOPMENT ONLY — deterministic, derived from the product's own real revenue/churn/margin data. */
function buildDevRevenueAnalystFixture(summary: RevenueSummary): RevenueAnalystOutput {
  const marginIsSustainable = summary.grossMarginPct !== null && summary.grossMarginPct >= MARGIN_SUSTAINABLE_FLOOR;
  return {
    summary: `[DEV FIXTURE] MRR $${summary.mrr.toFixed(2)} (ARR $${summary.arr.toFixed(2)}), gross margin ${summary.grossMarginPct === null ? "undefined" : `${(summary.grossMarginPct * 100).toFixed(1)}%`}, LTV:CAC ${formatResult(summary.unitEconomics.ltvToCac, "x")}.`,
    marginIsSustainable,
    reasoning: marginIsSustainable
      ? "[DEV FIXTURE] Gross margin clears the founder-configured floor on real, observed revenue and cost data."
      : "[DEV FIXTURE] Gross margin is below the founder-configured floor, or revenue is not yet established — the current price/cost structure does not clearly sustain the business yet.",
    confidence: summary.mrr > 0 ? 0.6 : 0.3,
  };
}

export interface RunRevenueAnalystParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export const revenueAnalystService = {
  async run(params: RunRevenueAnalystParams): Promise<RunOutcome<{ output: RevenueAnalystOutput; summary: RevenueSummary }>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "LIVE" && product.status !== "PAUSED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — Revenue Analyst only runs against a LIVE (or PAUSED) product.`);
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const revenueResult = await metricEngineService.computeAndRecordRevenueMetrics(product.id, now);
    const churnResult = await metricEngineService.computeAndRecordChurn(product.id, thirtyDaysAgo, now);

    const estimatedMonthlyCostUsd = product.estimatedOperatingCostUsd ?? 0;
    const costMetric = await businessMetricRepository.create({ productId: product.id, metricType: "MONTHLY_OPERATING_COST_USD", valueKind: "ESTIMATED", value: estimatedMonthlyCostUsd, source: "MANUAL_ENTRY" });

    const mrr = isComputed(revenueResult.mrr) ? revenueResult.mrr.value : 0;
    const grossMarginPct = mrr > 0 ? Math.max(-1, (mrr - estimatedMonthlyCostUsd) / mrr) : null;
    if (grossMarginPct !== null) {
      // Deterministically derived from the MRR row computeAndRecordRevenueMetrics just recorded (mrr > 0 guarantees
      // it exists) and the cost row just above — INFERRED requires a real inputMetricIds citation (assertMetricProvenance).
      const mrrMetric = await businessMetricRepository.findLatestForProductByType(product.id, "MRR");
      const inputMetricIds = [costMetric.id, ...(mrrMetric ? [mrrMetric.id] : [])];
      await businessMetricRepository.create({ productId: product.id, metricType: "GROSS_MARGIN_PCT", valueKind: "INFERRED", value: grossMarginPct, source: "DETERMINISTIC_CALCULATION", inputMetricIds });
    }

    const revenue = createRevenueProvider();
    const activeSubs = await revenue.listSubscriptionsAsOf(product.id, now);
    const oldestStart = activeSubs.reduce<Date | null>((oldest, s) => (!oldest || s.startedAt < oldest ? s.startedAt : oldest), null);
    const retentionHistoryMonths = oldestStart ? Math.floor((now.getTime() - oldestStart.getTime()) / (30 * 24 * 60 * 60 * 1000)) : 0;

    const unitEconomics = computeUnitEconomics({
      arpuUsd: revenueResult.arpu,
      grossMarginPct: grossMarginPct === null ? { status: "INSUFFICIENT_DATA", reason: "No revenue yet." } : computed(grossMarginPct),
      totalAcquisitionSpendUsd: null,
      newCustomersInPeriod: activeSubs.length,
      retentionHistoryMonths,
      avgCustomerLifespanMonths: retentionHistoryMonths >= 1 ? computed(retentionHistoryMonths) : { status: "INSUFFICIENT_DATA", reason: "No subscription has been active for a full month yet." },
    });

    const summary: RevenueSummary = {
      mrr,
      arr: isComputed(revenueResult.arr) ? revenueResult.arr.value : 0,
      arpu: isComputed(revenueResult.arpu) ? revenueResult.arpu.value : null,
      logoChurn: isComputed(churnResult.logoChurn) ? churnResult.logoChurn.value : null,
      revenueChurn: isComputed(churnResult.revenueChurn) ? churnResult.revenueChurn.value : null,
      estimatedMonthlyCostUsd,
      grossMarginPct,
      unitEconomics,
    };

    const execution = await agentRuntimeService.startExecution({ agentId: params.agentId, taskId: null, input: { productId: params.productId }, startedBy: params.startedBy });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, revenueAnalystOutputSchema, {
          systemPrompt: REVENUE_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildRevenueAnalystPrompt(summary) }],
          devFixtureResponse: buildDevRevenueAnalystFixture(summary),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "REVENUE_ANALYSIS_COMPLETED",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { mrr: summary.mrr, grossMarginPct: summary.grossMarginPct, confidence: output.confidence },
        });

        return { output, summary };
      },
      REVENUE_ANALYST_BUDGET,
    );
  },
};

import { randomUUID } from "node:crypto";
import type { PortfolioSnapshot, Product } from "@prisma/client";
import { z } from "zod";
import { businessHealthRepository } from "../db/repositories/business-health.repository.js";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { portfolioSnapshotRepository } from "../db/repositories/portfolio-snapshot.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeBusinessActionPriorityScore } from "../domain/decision/business-action.types.js";
import { PORTFOLIO_RECOMMENDATIONS, type PortfolioRecommendation } from "../domain/portfolio/portfolio.types.js";
import { isBusinessHealthState } from "../domain/business-health/business-health.types.js";
import { toJsonString } from "../domain/shared/json.js";
import { ValidationError } from "../domain/shared/errors.js";
import { killIntelligenceService } from "./kill-intelligence.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M8_ARCHITECTURE_PROPOSAL.md §24, §28) — compares products, never itself moves anything. */
export const PORTFOLIO_ANALYST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 20_000,
};

const portfolioAnalystOutputSchema = z.object({
  rankings: z
    .array(
      z.object({
        productId: z.string().min(1),
        recommendation: z.enum(PORTFOLIO_RECOMMENDATIONS),
        reasoning: z.string().min(1),
      }),
    )
    .min(1),
  confidence: z.number().min(0).max(1),
});
export type PortfolioAnalystOutput = z.infer<typeof portfolioAnalystOutputSchema>;

interface ProductPortfolioInput {
  product: Product;
  revenueUsd: number;
  growthRatePct: number;
  retentionPct: number;
  marginPct: number;
  evidenceConfidence: number;
  killRiskScore: number;
  businessHealthState: string;
  priorityScore: number;
}

const PORTFOLIO_ANALYST_SYSTEM_PROMPT =
  "You are the Portfolio Analyst for VentureForge (docs/M8_ARCHITECTURE_PROPOSAL.md §24, §28) — Constitution §19: " +
  '"VentureForge may operate multiple SaaS businesses simultaneously. The company should continuously evaluate: ' +
  'SCALE, MAINTAIN, INVESTIGATE, PIVOT, PAUSE, RETIRE." Compare every live product\'s already-computed metrics and ' +
  "recommend exactly one of those six verbs per product — you have no tools and never move any resource yourself; " +
  "AI may recommend shutting down an underperforming product, but final authority for high-impact shutdown " +
  "decisions remains with the Human Owner (Constitution §19). A RETIRE or PIVOT recommendation will separately " +
  "trigger a full CEO review before anything happens — it is never itself an execution. " +
  'Respond with ONLY JSON matching: {"rankings": [{"productId": string, "recommendation": ' +
  '"SCALE"|"MAINTAIN"|"INVESTIGATE"|"PIVOT"|"PAUSE"|"RETIRE", "reasoning": string}], "confidence": number}';

function buildPortfolioAnalystPrompt(inputs: readonly ProductPortfolioInput[]): string {
  return inputs
    .map(
      (i) =>
        `- [productId=${i.product.id}] revenue=$${i.revenueUsd.toFixed(2)}, growth=${(i.growthRatePct * 100).toFixed(1)}%, retention=${(i.retentionPct * 100).toFixed(1)}%, margin=${(i.marginPct * 100).toFixed(1)}%, evidenceConfidence=${i.evidenceConfidence.toFixed(2)}, killRisk=${i.killRiskScore.toFixed(2)}, businessHealth=${i.businessHealthState}, priorityScore=${i.priorityScore.toFixed(3)}`,
    )
    .join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, derived directly from each
 * product's own real BusinessHealth state (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §28) — every Constitution §19 verb has a real, distinct trigger, so
 * changing a product's underlying data changes its recommendation
 * (proven by the portfolio capstone, never a static fixture).
 */
function buildDevPortfolioAnalystFixture(inputs: readonly ProductPortfolioInput[]): PortfolioAnalystOutput {
  const rankings = inputs.map((i) => {
    let recommendation: PortfolioRecommendation;
    let reasoning: string;
    switch (i.businessHealthState) {
      case "HEALTHY":
        recommendation = "SCALE";
        reasoning = `[DEV FIXTURE] BusinessHealth is HEALTHY (priorityScore=${i.priorityScore.toFixed(3)}) — this product is the strongest candidate for additional investment in the portfolio.`;
        break;
      case "PROMISING":
        recommendation = i.growthRatePct > 0.05 ? "SCALE" : "MAINTAIN";
        reasoning = `[DEV FIXTURE] BusinessHealth is PROMISING; growth rate ${(i.growthRatePct * 100).toFixed(1)}% ${i.growthRatePct > 0.05 ? "justifies scaling further" : "does not yet justify scaling beyond maintaining current investment"}.`;
        break;
      case "STAGNATING":
        recommendation = "PIVOT";
        reasoning = "[DEV FIXTURE] BusinessHealth is STAGNATING — the current strategy is not moving the numbers; a change in approach (pricing, channel, or product direction), not more of the same, is warranted.";
        break;
      case "DECLINING":
        recommendation = "PAUSE";
        reasoning = "[DEV FIXTURE] BusinessHealth is DECLINING — reduce active investment while the underlying cause is diagnosed, short of a full kill review.";
        break;
      case "CRITICAL":
        recommendation = "RETIRE";
        reasoning = `[DEV FIXTURE] BusinessHealth is CRITICAL with combined kill risk ${i.killRiskScore.toFixed(2)} — this product should go through a kill review rather than continue consuming resources.`;
        break;
      default:
        recommendation = "INVESTIGATE";
        reasoning = "[DEV FIXTURE] Evidence is too early/thin (EARLY or UNKNOWN BusinessHealth) to recommend scaling, pausing, or retiring responsibly yet.";
    }
    return { productId: i.product.id, recommendation, reasoning };
  });

  return { rankings, confidence: 0.6 };
}

export interface RunPortfolioAnalystParams {
  agentId: string;
  productIds: readonly string[];
  startedBy: AuthenticatedActor;
}

export interface PortfolioAnalystResult {
  runId: string;
  snapshots: PortfolioSnapshot[];
}

export const portfolioAnalystService = {
  async run(params: RunPortfolioAnalystParams): Promise<RunOutcome<PortfolioAnalystResult>> {
    if (params.productIds.length === 0) {
      throw new ValidationError("Portfolio Analyst requires at least one product id.");
    }

    const inputs: ProductPortfolioInput[] = [];
    for (const productId of params.productIds) {
      const product = await productRepository.findById(productId);
      if (!product) throw new ValidationError(`Product ${productId} not found.`);
      if (product.status !== "LIVE" && product.status !== "PAUSED") {
        throw new ValidationError(`Product ${productId} is ${product.status} — the Portfolio Analyst only compares LIVE (or PAUSED) products.`);
      }

      const [health, mrrMetric, retentionMetric, opportunity] = await Promise.all([
        businessHealthRepository.findLatestForProduct(productId),
        businessMetricRepository.findLatestForProductByType(productId, "MRR"),
        businessMetricRepository.findLatestForProductByType(productId, "RETENTION_D30"),
        opportunityRepository.listScoreRecords(product.opportunityId),
      ]);
      const latestOpportunityKillRiskScore = opportunity[0]?.killRiskScore ?? 0;

      const dimensions = health
        ? { productHealth: health.productHealth, customerHealth: health.customerHealth, revenueHealth: health.revenueHealth, growthHealth: health.growthHealth, marginHealth: health.marginHealth, evidenceConfidence: health.evidenceConfidence, risk: health.risk }
        : { productHealth: 0, customerHealth: 0, revenueHealth: 0, growthHealth: 0, marginHealth: 0, evidenceConfidence: 0, risk: 0.5 };

      const killAssessment = killIntelligenceService.assess({
        priorOpportunityKillRiskScore: latestOpportunityKillRiskScore ?? 0,
        retentionHealth: dimensions.customerHealth,
        revenueHealth: dimensions.revenueHealth,
        growthHealth: dimensions.growthHealth,
        marginHealth: dimensions.marginHealth,
        evidenceConfidence: dimensions.evidenceConfidence,
      });

      const priorityScore = computeBusinessActionPriorityScore(dimensions);

      inputs.push({
        product,
        revenueUsd: mrrMetric?.value ?? 0,
        growthRatePct: dimensions.growthHealth * 2 - 1,
        retentionPct: retentionMetric?.value ?? 0,
        marginPct: dimensions.marginHealth * 2 - 1,
        evidenceConfidence: dimensions.evidenceConfidence,
        killRiskScore: killAssessment.combinedKillRiskScore,
        businessHealthState: health && isBusinessHealthState(health.state) ? health.state : "UNKNOWN",
        priorityScore,
      });
    }

    const execution = await agentRuntimeService.startExecution({ agentId: params.agentId, taskId: null, input: { productIds: params.productIds }, startedBy: params.startedBy });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, portfolioAnalystOutputSchema, {
          systemPrompt: PORTFOLIO_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildPortfolioAnalystPrompt(inputs) }],
          devFixtureResponse: buildDevPortfolioAnalystFixture(inputs),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const rankingByProductId = new Map(output.rankings.map((r) => [r.productId, r] as const));
        const missing = inputs.filter((i) => !rankingByProductId.has(i.product.id));
        if (missing.length > 0) {
          throw new ValidationError(`Portfolio ranking is missing ${missing.length} of ${inputs.length} requested product(s) — refusing an incomplete portfolio snapshot.`);
        }

        const runId = randomUUID();
        const snapshots: PortfolioSnapshot[] = [];
        for (const input of inputs) {
          const ranking = rankingByProductId.get(input.product.id);
          if (!ranking) continue;
          snapshots.push(
            await portfolioSnapshotRepository.create({
              productId: input.product.id,
              runId,
              revenueUsd: input.revenueUsd,
              growthRatePct: input.growthRatePct,
              retentionPct: input.retentionPct,
              marginPct: input.marginPct,
              evidenceConfidence: input.evidenceConfidence,
              killRiskScore: input.killRiskScore,
              priorityScore: input.priorityScore,
              recommendation: ranking.recommendation,
              reasoning: ranking.reasoning,
              citedMetricIds: toJsonString([]),
            }),
          );
        }

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "PORTFOLIO_ANALYSIS_COMPLETED",
          resourceType: "PORTFOLIO",
          resourceId: runId,
          result: "SUCCESS",
          metadata: { productCount: inputs.length, confidence: output.confidence },
        });

        return { runId, snapshots };
      },
      PORTFOLIO_ANALYST_BUDGET,
    );
  },
};

import type { Briefing } from "@prisma/client";
import { briefingRepository } from "../db/repositories/briefing.repository.js";
import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { companyReviewRepository } from "../db/repositories/company-review.repository.js";
import { growthExperimentRepository } from "../db/repositories/growth-experiment.repository.js";
import { learningRecordRepository } from "../db/repositories/learning-record.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { PORTFOLIO_BUCKETS } from "../domain/company-state/company-state.types.js";
import { briefingContentSchema, type BriefingContent, type BriefingStatement } from "../domain/briefing/briefing.types.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import type { MetricResult } from "../domain/shared/metric-result.js";
import { alertService } from "./alert.service.js";
import { companyStateService } from "./company-state.service.js";
import { founderAttentionService } from "./founder-attention.service.js";
import { founderDecisionQueueService } from "./founder-decision-queue.service.js";
import { portfolioControlService } from "./portfolio-control.service.js";

function formatMetric(result: MetricResult): string {
  if (result.status === "COMPUTED") return result.value.toFixed(2);
  if (result.status === "INSUFFICIENT_DATA") return `INSUFFICIENT_DATA (${result.reason})`;
  return "UNKNOWN";
}

function statement(text: string, citedIds: readonly string[]): BriefingStatement[] {
  return citedIds.length > 0 ? [{ statement: text, citedIds: [...citedIds] }] : [];
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `briefingService.generate()` (docs/M9_ARCHITECTURE_PROPOSAL.md §46,
 * M9 brief §34) — the brief's own literal eleven-section structure,
 * each section a DIRECT citation of an already-built read. "Every
 * important statement must be evidence-backed" is enforced
 * structurally by `briefingContentSchema` (Zod, §46): a section with
 * nothing real to cite is an empty array, never invented prose.
 */
export const briefingService = {
  async generate(periodStart?: Date, periodEnd: Date = new Date()): Promise<Briefing> {
    const start = periodStart ?? new Date(periodEnd.getTime() - ONE_WEEK_MS);

    const [companyState, portfolio, alerts, allOpportunities, allExperiments, allProducts, attentionQueue, undecidedRecommendations, recentLearningRecords] = await Promise.all([
      companyStateService.getState(),
      portfolioControlService.overview(),
      alertService.listUnacknowledged(),
      opportunityRepository.list(),
      growthExperimentRepository.list(),
      productRepository.list(),
      founderAttentionService.listAboveBriefingThreshold(),
      companyRecommendationRepository.listUndecided(),
      learningRecordRepository.list(),
    ]);

    const liveProductIds = allProducts.filter((p) => p.status === "LIVE").map((p) => p.id);

    const COMPANY = statement(
      `Revenue ${formatMetric(companyState.revenue)}, growth ${formatMetric(companyState.growth)}, portfolio of ${companyState.portfolioSize} product(s), portfolio health ${formatMetric(companyState.portfolioHealth)}, risk ${formatMetric(companyState.risk)}.`,
      liveProductIds,
    );

    const PORTFOLIO: BriefingStatement[] = [];
    for (const bucket of PORTFOLIO_BUCKETS) {
      const entries = portfolio[bucket];
      if (entries.length === 0) continue;
      PORTFOLIO.push({ statement: `${bucket}: ${entries.length} product(s).`, citedIds: entries.map((e) => e.productId) });
    }

    const REVENUE = statement(`Company-wide revenue (SUM MRR across LIVE products): ${formatMetric(companyState.revenue)}.`, liveProductIds);
    const GROWTH = statement(`Company-wide growth (AVG growthHealth): ${formatMetric(companyState.growth)}.`, liveProductIds);

    const RISKS: BriefingStatement[] = alerts.map((a) => ({ statement: `[${a.severity}] ${a.message}`, citedIds: [a.id] }));

    const highValueOpportunities = allOpportunities.filter((o) => (o.opportunityScore ?? 0) >= 0.6);
    const OPPORTUNITIES: BriefingStatement[] = highValueOpportunities.map((o) => ({ statement: `${o.title} — opportunity score ${(o.opportunityScore ?? 0).toFixed(2)}.`, citedIds: [o.id] }));

    const activeExperiments = allExperiments.filter((e) => e.status === "RUNNING" || e.status === "COMPLETED" || e.status === "AWAITING_APPROVAL");
    const EXPERIMENTS: BriefingStatement[] = activeExperiments.map((e) => ({ statement: `"${e.hypothesis}" — status ${e.status}.`, citedIds: [e.id] }));

    const DECISIONS_REQUIRED: BriefingStatement[] = attentionQueue.map((q) => ({
      statement: `${q.scored.entry.summary} (score ${q.item.score.toFixed(2)}: financialImpact=${q.scored.factors.financialImpact.toFixed(2)}, urgency=${q.scored.factors.urgency.toFixed(2)}, risk=${q.scored.factors.risk.toFixed(2)}, uncertainty=${q.scored.factors.uncertainty.toFixed(2)}, reversibility=${q.scored.factors.reversibility.toFixed(2)}).`,
      citedIds: [q.item.id],
    }));

    const topCeoRecommendations = [...undecidedRecommendations].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    const CEO_TOP_RECOMMENDATIONS: BriefingStatement[] = topCeoRecommendations.map((r) => ({ statement: `${r.action} (confidence ${r.confidence.toFixed(2)}): ${r.reasoning}`, citedIds: [r.id] }));

    const chairmanReviews = await Promise.all(topCeoRecommendations.map((r) => companyReviewRepository.findLatestForRecommendation(r.id)));
    const CHAIRMAN_CONCERNS: BriefingStatement[] = [];
    for (const review of chairmanReviews) {
      if (!review) continue;
      const objections = fromJsonString<string[]>(review.objections, []);
      if (objections.length === 0) continue;
      CHAIRMAN_CONCERNS.push({ statement: `${review.decision}: ${objections[0]}`, citedIds: [review.id] });
    }

    const periodLearningRecords = recentLearningRecords.filter((r) => r.createdAt.getTime() >= start.getTime());
    const LESSONS_FROM_LAST_PERIOD: BriefingStatement[] = periodLearningRecords
      .filter((r) => r.lesson !== null)
      .map((r) => ({ statement: r.lesson as string, citedIds: [r.id] }));

    const content: BriefingContent = {
      COMPANY,
      PORTFOLIO,
      REVENUE,
      GROWTH,
      RISKS,
      OPPORTUNITIES,
      EXPERIMENTS,
      DECISIONS_REQUIRED,
      CEO_TOP_RECOMMENDATIONS,
      CHAIRMAN_CONCERNS,
      LESSONS_FROM_LAST_PERIOD,
      // M9 brief §36 — a real, valid, honest output, never a manufactured decision to look productive.
      status: DECISIONS_REQUIRED.length > 0 ? "ACTION_REQUIRED" : "NO_ACTION_REQUIRED",
    };

    const validated = briefingContentSchema.parse(content);
    const decisionQueueSnapshot = await founderDecisionQueueService.listPending();

    return briefingRepository.create({
      periodStart: start,
      periodEnd,
      content: toJsonString(validated),
      status: validated.status,
      decisionQueueSnapshot: toJsonString(decisionQueueSnapshot),
    });
  },

  getLatest: briefingRepository.findLatest,
  list: briefingRepository.list,
};

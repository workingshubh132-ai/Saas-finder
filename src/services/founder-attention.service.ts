import type { FounderAttentionItem } from "@prisma/client";
import { founderAttentionItemRepository } from "../db/repositories/founder-attention-item.repository.js";
import { MIN_ATTENTION_SCORE_FOR_BRIEFING, type FounderAttentionFactors } from "../domain/attention/attention-score.js";
import type { DecisionQueueEntry } from "../domain/decision-queue/decision-queue.types.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { attentionScoringService, type ScoredEntry } from "./attention-scoring.service.js";
import { eventBus } from "./event-bus.js";
import { founderDecisionQueueService } from "./founder-decision-queue.service.js";

const ZERO_FACTORS: FounderAttentionFactors = {
  financialImpact: 0,
  urgency: 0,
  risk: 0,
  uncertainty: 0,
  reversibility: 0,
  opportunityCost: 0,
  evidenceQuality: 0,
  strategicImportance: 0,
  deadlineProximity: 0,
};

export interface FounderAttentionQueueItem {
  readonly item: FounderAttentionItem;
  readonly scored: ScoredEntry;
}

function summarize(scored: ScoredEntry): string {
  return `${scored.entry.summary} (attention ${scored.score.toFixed(2)})`;
}

/**
 * The Founder Attention Queue (docs/M9_ARCHITECTURE_PROPOSAL.md §18-19,
 * M9 brief §5-7) — "founder attention is a scarce resource," so this
 * never dumps every pending decision unranked. `refresh()` re-reads
 * the unified Human Decision Queue (§19), scores every entry, and
 * persists exactly one open `FounderAttentionItem` per underlying
 * resource — a second refresh before the first is reviewed never
 * creates a duplicate for the same decision.
 */
export const founderAttentionService = {
  async refresh(): Promise<FounderAttentionQueueItem[]> {
    const entries = await founderDecisionQueueService.listPending();
    const scoredEntries = await attentionScoringService.scoreAll(entries);

    for (const scored of scoredEntries) {
      if (!scored.entry.resourceId) continue;
      const existing = await founderAttentionItemRepository.findOpenForResource(scored.entry.resourceType, scored.entry.resourceId, scored.entry.source);
      if (existing) continue;

      const item = await founderAttentionItemRepository.create({
        resourceType: scored.entry.resourceType,
        resourceId: scored.entry.resourceId,
        sourceKind: scored.entry.sourceKind,
        source: scored.entry.source,
        score: scored.score,
        factors: toJsonString(scored.factors),
        summary: summarize(scored),
      });
      await eventBus.publish({ type: "ATTENTION_QUEUE_UPDATED", payload: { founderAttentionItemId: item.id, resourceType: item.resourceType, resourceId: item.resourceId, score: item.score } });
    }

    return this.listQueue();
  },

  async listQueue(): Promise<FounderAttentionQueueItem[]> {
    const items = await founderAttentionItemRepository.listUnreviewed();
    const entries = await founderDecisionQueueService.listPending();
    const entryByKey = new Map<string, DecisionQueueEntry>(entries.map((e) => [`${e.source}:${e.resourceId ?? e.id}`, e]));

    const paired: FounderAttentionQueueItem[] = [];
    for (const item of items) {
      const entry = entryByKey.get(`${item.source}:${item.resourceId}`);
      if (!entry) continue;
      const factors = fromJsonString<FounderAttentionFactors>(item.factors, ZERO_FACTORS);
      paired.push({ item, scored: { entry, factors, score: item.score } });
    }
    return paired.sort((a, b) => b.item.score - a.item.score);
  },

  /** Above the "no genuinely important decision" floor (§18) — what the Weekend Briefing (§46) actually surfaces. */
  async listAboveBriefingThreshold(): Promise<FounderAttentionQueueItem[]> {
    const queue = await this.listQueue();
    return queue.filter((q) => q.item.score >= MIN_ATTENTION_SCORE_FOR_BRIEFING);
  },

  markReviewed(itemId: string): Promise<FounderAttentionItem> {
    return founderAttentionItemRepository.markReviewed(itemId);
  },
};

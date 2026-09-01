import type { ResearchQueueItem } from "@prisma/client";
import { evidenceGapRepository } from "../db/repositories/evidence-gap.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { researchQueueRepository } from "../db/repositories/research-queue.repository.js";
import { computeQueuePriority } from "../domain/research-queue/priority.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS, isResearchQueueItemStatus } from "../domain/research-queue/research-queue.types.js";

/** Flat, documented placeholder — no real per-item research cost model
 *  exists yet (every queue item today is "resolve one evidence gap",
 *  roughly comparable effort); see docs/DECISIONS.md. */
const DEFAULT_ESTIMATED_COST = 0.3;

/**
 * The prioritized research queue (M3 brief Part 30-31): populated from
 * an opportunity's unresolved evidence gaps after each analysis pass,
 * ranked by documented priority (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §13) — never simply "highest score first."
 */
export const researchQueueService = {
  async populateForOpportunity(opportunityId: string): Promise<ResearchQueueItem[]> {
    const opportunity = await opportunityRepository.findById(opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", opportunityId);

    const [gaps, scoreRecords] = await Promise.all([
      evidenceGapRepository.listUnresolvedForOpportunity(opportunityId),
      opportunityRepository.listScoreRecords(opportunityId),
    ]);
    const latestKillRisk = scoreRecords[0]?.killRiskScore ?? 0;

    const items: ResearchQueueItem[] = [];
    for (const gap of gaps) {
      const priorityScore = computeQueuePriority({
        informationGain: gap.impactScore,
        opportunityScore: opportunity.opportunityScore ?? 0,
        killRiskScore: latestKillRisk,
        estimatedResearchCost: DEFAULT_ESTIMATED_COST,
      });
      items.push(
        await researchQueueRepository.create({
          opportunityId,
          evidenceGapId: gap.id,
          kind: "RESOLVE_EVIDENCE_GAP",
          priorityScore,
          reason: gap.suggestedResearchQuestion,
        }),
      );
    }
    return items;
  },

  /** The single highest-priority item still waiting — "resolve the
   *  biggest uncertainty," not "research the top-scoring opportunity." */
  next: researchQueueRepository.findHighestPriorityPending,

  list: researchQueueRepository.list,

  async markInProgress(id: string): Promise<ResearchQueueItem> {
    return transitionItem(id, "IN_PROGRESS");
  },

  async markDone(id: string): Promise<ResearchQueueItem> {
    return transitionItem(id, "DONE");
  },

  async markSkipped(id: string): Promise<ResearchQueueItem> {
    return transitionItem(id, "SKIPPED");
  },
};

async function transitionItem(id: string, toStatus: string): Promise<ResearchQueueItem> {
  if (!isResearchQueueItemStatus(toStatus)) {
    throw new ValidationError(`Unknown research queue item status: ${toStatus}`);
  }
  const item = await researchQueueRepository.findById(id);
  if (!item) throw new NotFoundError("ResearchQueueItem", id);
  if (!isResearchQueueItemStatus(item.status)) {
    throw new ValidationError(`Corrupt stored status on research queue item ${item.id}: ${item.status}`);
  }
  assertTransition("ResearchQueueItem", RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS, item.status, toStatus);
  return researchQueueRepository.updateStatus(id, toStatus);
}

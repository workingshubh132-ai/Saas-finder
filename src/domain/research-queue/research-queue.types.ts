import type { TransitionTable } from "../shared/state-machine.js";

/** M3 brief Part 30. What kind of next research action this item represents. */
export const RESEARCH_QUEUE_ITEM_KINDS = ["RESOLVE_EVIDENCE_GAP", "DEEPEN_RESEARCH", "NEW_SIGNAL_SWEEP"] as const;
export type ResearchQueueItemKind = (typeof RESEARCH_QUEUE_ITEM_KINDS)[number];

export function isResearchQueueItemKind(value: string): value is ResearchQueueItemKind {
  return (RESEARCH_QUEUE_ITEM_KINDS as readonly string[]).includes(value);
}

export const RESEARCH_QUEUE_ITEM_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "SKIPPED"] as const;
export type ResearchQueueItemStatus = (typeof RESEARCH_QUEUE_ITEM_STATUSES)[number];

export function isResearchQueueItemStatus(value: string): value is ResearchQueueItemStatus {
  return (RESEARCH_QUEUE_ITEM_STATUSES as readonly string[]).includes(value);
}

export const RESEARCH_QUEUE_ITEM_STATUS_TRANSITIONS: TransitionTable<ResearchQueueItemStatus> = {
  PENDING: ["IN_PROGRESS", "SKIPPED"],
  IN_PROGRESS: ["DONE", "SKIPPED", "PENDING"],
  DONE: [],
  SKIPPED: [],
};

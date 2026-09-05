import { operatingCycleRepository } from "../db/repositories/operating-cycle.repository.js";
import { eventRepository } from "../db/repositories/event.repository.js";
import { fromJsonString } from "../domain/shared/json.js";

export interface TimelineCycleContext {
  readonly cycleId: string;
  readonly stage: string;
}

export interface TimelineEntry {
  readonly occurredAt: Date;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /** Which OperatingCycle/stage was active when this event fired, if any — a time-window correlation, not a foreign key (Event carries none by design, §1). */
  readonly cycleContext: TimelineCycleContext | null;
}

const DEFAULT_TIMELINE_LIMIT = 200;

/**
 * `companyStateService.getTimeline(since)` (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §43) — a pure read over `Event` (now complete, §42), ordered by
 * `occurredAt`, annotated with cycle-relative context ("Saturday 18:20
 * Human approves", the brief's own §31 example) by matching each
 * event's `occurredAt` against the CycleStageEvent windows it falls
 * inside. No new event-storage mechanism — `Event.payload` already
 * carries enough to reconstruct what happened.
 */
export const companyTimelineService = {
  async getTimeline(since?: Date, limit: number = DEFAULT_TIMELINE_LIMIT): Promise<TimelineEntry[]> {
    const [events, stageEvents] = await Promise.all([eventRepository.list({ since, limit }), operatingCycleRepository.listAllStageEvents(since)]);

    return events.map((event) => {
      const match = stageEvents.find((se) => se.enteredAt.getTime() <= event.occurredAt.getTime() && (se.completedAt === null || se.completedAt.getTime() >= event.occurredAt.getTime()));
      return {
        occurredAt: event.occurredAt,
        type: event.type,
        payload: fromJsonString<Record<string, unknown>>(event.payload, {}),
        cycleContext: match ? { cycleId: match.cycleId, stage: match.stage } : null,
      };
    });
  },
};

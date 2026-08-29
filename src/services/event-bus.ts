import { eventRepository } from "../db/repositories/event.repository.js";
import { toJsonString } from "../domain/shared/json.js";
import type { DomainEventInput } from "../domain/events/event.types.js";

type Subscriber = (event: DomainEventInput) => void;

const subscribers = new Set<Subscriber>();

/**
 * In-process outbox: every publish is persisted to the `events` table
 * first (the durable, queryable record), then fanned out to any
 * in-process subscribers. M1 ships no subscribers of its own — nothing
 * in the vertical slice depends on async side effects — but the seam
 * exists for M2 handlers (e.g. "on OPPORTUNITY_DISCOVERED, notify
 * Intelligence") without a message broker.
 */
export const eventBus = {
  async publish(event: DomainEventInput): Promise<void> {
    await eventRepository.append({ type: event.type, payload: toJsonString(event.payload) });
    for (const subscriber of subscribers) subscriber(event);
  },

  subscribe(subscriber: Subscriber): () => void {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  },
};

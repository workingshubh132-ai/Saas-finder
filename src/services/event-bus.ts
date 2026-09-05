import { eventRepository } from "../db/repositories/event.repository.js";
import { toJsonString } from "../domain/shared/json.js";
import type { DomainEventInput } from "../domain/events/event.types.js";

type Subscriber = (event: DomainEventInput) => void | Promise<void>;

const subscribers = new Set<Subscriber>();

/**
 * In-process outbox: every publish is persisted to the `events` table
 * first (the durable, queryable record), then fanned out to any
 * in-process subscribers, each one awaited in turn. M1 shipped no
 * subscribers of its own; `autonomousOperationsService`
 * (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) is the first — the seam this
 * comment always described, finally used, not a new mechanism.
 *
 * Awaiting subscribers (rather than the original fire-and-forget) is
 * the one real change here: without it, automation would race the
 * publisher's own caller, making every reaction untestable and
 * non-deterministic. A subscriber's own failure is caught and never
 * propagated — one handler misbehaving must never break the publisher
 * or any other subscriber (bounded, retry-safe — brief item 5).
 */
export const eventBus = {
  async publish(event: DomainEventInput): Promise<void> {
    await eventRepository.append({ type: event.type, payload: toJsonString(event.payload) });
    for (const subscriber of subscribers) {
      try {
        await subscriber(event);
      } catch (err) {
        console.error(`eventBus subscriber failed handling "${event.type}":`, err);
      }
    }
  },

  subscribe(subscriber: Subscriber): () => void {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  },
};

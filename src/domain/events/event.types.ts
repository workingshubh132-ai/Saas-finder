/** Domain events (Constitution §14 of the M1 brief) — the minimum set
 *  named there. Extending this list is expected but out of M1 scope
 *  beyond what the vertical slice actually emits. */
export const DOMAIN_EVENT_TYPES = [
  "AGENT_CREATED",
  "AGENT_SUSPENDED",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "EVIDENCE_ADDED",
  "OPPORTUNITY_DISCOVERED",
  "OPPORTUNITY_SCORED",
  "OPPORTUNITY_UPDATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

export interface DomainEventInput {
  readonly type: DomainEventType;
  /** Enough information to reconstruct what happened without a join. */
  readonly payload: Record<string, unknown>;
}

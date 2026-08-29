export const ACTOR_TYPES = ["AGENT", "HUMAN", "SYSTEM"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export function isActorType(value: string): value is ActorType {
  return (ACTOR_TYPES as readonly string[]).includes(value);
}

export const AUDIT_RESULTS = ["SUCCESS", "FAILURE", "DENIED"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export function isAuditResult(value: string): value is AuditResult {
  return (AUDIT_RESULTS as readonly string[]).includes(value);
}

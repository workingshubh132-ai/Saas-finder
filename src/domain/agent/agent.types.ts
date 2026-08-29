import type { TransitionTable } from "../shared/state-machine.js";

export const AGENT_STATUSES = ["ACTIVE", "PAUSED", "SUSPENDED", "RETIRED"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

/** CEO's departments (Constitution §3) plus the two roles that sit
 *  outside them but still need an Agent Registry entry in M1. */
export const AGENT_DEPARTMENTS = [
  "INTELLIGENCE",
  "VALIDATION",
  "SALES",
  "PRODUCT",
  "ENGINEERING",
  "GROWTH",
  "OPERATIONS",
  "EXECUTIVE",
  "GUARDIAN",
] as const;
export type AgentDepartment = (typeof AGENT_DEPARTMENTS)[number];

export function isAgentDepartment(value: string): value is AgentDepartment {
  return (AGENT_DEPARTMENTS as readonly string[]).includes(value);
}

/**
 * No agent has an inherent right to remain active (Constitution §26).
 * RETIRED is terminal — a retired agent is not reinstated, a new one
 * is registered.
 */
export const AGENT_STATUS_TRANSITIONS: TransitionTable<AgentStatus> = {
  ACTIVE: ["PAUSED", "SUSPENDED", "RETIRED"],
  PAUSED: ["ACTIVE", "SUSPENDED", "RETIRED"],
  SUSPENDED: ["ACTIVE", "PAUSED", "RETIRED"],
  RETIRED: [],
};

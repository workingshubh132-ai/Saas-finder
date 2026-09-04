import type { TransitionTable } from "../shared/state-machine.js";

export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export function isIncidentSeverity(value: string): value is IncidentSeverity {
  return (INCIDENT_SEVERITIES as readonly string[]).includes(value);
}

/** Incident lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §26). RESOLVED -> INVESTIGATING models a recurrence. */
export const INCIDENT_STATUSES = ["DETECTED", "TRIAGED", "INVESTIGATING", "MITIGATING", "RESOLVED", "POSTMORTEM"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export const INCIDENT_STATUS_TRANSITIONS: TransitionTable<IncidentStatus> = {
  DETECTED: ["TRIAGED"],
  TRIAGED: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATING", "RESOLVED"],
  MITIGATING: ["RESOLVED"],
  RESOLVED: ["POSTMORTEM", "INVESTIGATING"],
  POSTMORTEM: [],
};

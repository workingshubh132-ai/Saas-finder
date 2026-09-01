import type { TransitionTable } from "../shared/state-machine.js";

/** M3 brief Part 12. A cluster groups signals about a common
 *  underlying problem/theme (docs/M3_ARCHITECTURE_PROPOSAL.md §6). */
export const CLUSTER_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];

export function isClusterStatus(value: string): value is ClusterStatus {
  return (CLUSTER_STATUSES as readonly string[]).includes(value);
}

export const CLUSTER_STATUS_TRANSITIONS: TransitionTable<ClusterStatus> = {
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};

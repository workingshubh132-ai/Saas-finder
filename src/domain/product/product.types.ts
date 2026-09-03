import type { TransitionTable } from "../shared/state-machine.js";

/**
 * Product lifecycle (docs/M6_ARCHITECTURE_PROPOSAL.md §21, §34) — one
 * row per opportunity build attempt (§3), not a versioned family.
 * Deliberately no DEPLOYED state: M6 produces a deployment plan and
 * stops at READY_FOR_DEPLOYMENT (§25) — never an autonomous deploy.
 */
export const PRODUCT_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "SPECIFYING",
  "ARCHITECTING",
  "BUILDING",
  "REVIEWING",
  "TESTING",
  "SECURITY_REVIEW",
  "HUMAN_REVIEW",
  "READY_FOR_DEPLOYMENT",
  "REJECTED",
  "FAILED",
  "ARCHIVED",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value);
}

/**
 * REVIEWING/TESTING/SECURITY_REVIEW each map to one pipeline stage
 * (Code Review / QA+Integration Test / Security) and can fall back to
 * BUILDING for a bounded rework attempt (§28 failure handling) — never
 * a silent skip forward. HUMAN_REVIEW's REQUEST_CHANGES branches back
 * to ARCHITECTING (the spec/architecture itself needs rework) or
 * BUILDING (only the implementation does) — the caller decides which,
 * both are legal. FAILED is reachable from every non-terminal state
 * (attempt-cap exceeded, §28); ARCHIVED only from a terminal state,
 * mirroring Opportunity's own archive-from-terminal convention.
 */
export const PRODUCT_STATUS_TRANSITIONS: TransitionTable<ProductStatus> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["SPECIFYING", "FAILED"],
  SPECIFYING: ["ARCHITECTING", "FAILED"],
  ARCHITECTING: ["BUILDING", "FAILED"],
  BUILDING: ["REVIEWING", "FAILED"],
  REVIEWING: ["TESTING", "BUILDING", "FAILED"],
  TESTING: ["SECURITY_REVIEW", "BUILDING", "FAILED"],
  SECURITY_REVIEW: ["HUMAN_REVIEW", "BUILDING", "FAILED"],
  HUMAN_REVIEW: ["READY_FOR_DEPLOYMENT", "REJECTED", "ARCHITECTING", "BUILDING", "FAILED"],
  READY_FOR_DEPLOYMENT: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  FAILED: ["ARCHIVED"],
  ARCHIVED: [],
};

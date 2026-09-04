import type { TransitionTable } from "../shared/state-machine.js";

/**
 * Product lifecycle (docs/M6_ARCHITECTURE_PROPOSAL.md §21, §34;
 * extended past READY_FOR_DEPLOYMENT by docs/M7_ARCHITECTURE_PROPOSAL.md
 * §15) — one row per opportunity build attempt (§3), not a versioned
 * family. LIVE is real only when a real Deployment row with
 * status="LIVE" exists — never set speculatively, never set by an
 * agent (M7 §15, brief Section 45: "do not create fake production
 * states for fixtures").
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
  // M7 — docs/M7_ARCHITECTURE_PROPOSAL.md §15.
  "LAUNCH_PLANNING",
  "AWAITING_LAUNCH_APPROVAL",
  "DEPLOYING",
  "LIVE",
  "PAUSED",
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
 * both are legal. FAILED is reachable from every non-terminal state up
 * through DEPLOYING (attempt-cap exceeded / a rejected launch review,
 * §28); ARCHIVED only from a terminal state, mirroring Opportunity's
 * own archive-from-terminal convention.
 *
 * M7 (docs/M7_ARCHITECTURE_PROPOSAL.md §15) — LAUNCH_PLANNING onward.
 * setStatus to DEPLOYING/LIVE is called only from the deployment
 * EXECUTE step (deployment.service.ts), never from productFactoryService
 * and never from any agent-reachable code path. LIVE/PAUSED
 * deliberately do NOT transition to FAILED — FAILED means "this
 * build/launch attempt failed," which doesn't describe an already-live
 * product; a live product's operational problems are Incident rows,
 * not a Product-status regression. LIVE/PAUSED -> ARCHIVED models a
 * human's deliberate kill of a live product directly
 * (CONSTITUTION.md: "Final authority for high-impact shutdown
 * decisions remains with the Human Owner").
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
  READY_FOR_DEPLOYMENT: ["LAUNCH_PLANNING", "ARCHIVED"],
  LAUNCH_PLANNING: ["AWAITING_LAUNCH_APPROVAL", "FAILED"],
  // AWAITING_LAUNCH_APPROVAL is the LaunchReviewMemo's own human-review
  // state: APPROVE stays here (a human separately requests the
  // DeploymentPlan's own RED-tier approval next, §5-6); REQUEST_CHANGES
  // -> LAUNCH_PLANNING (a bounded rework pass); REJECT -> FAILED.
  AWAITING_LAUNCH_APPROVAL: ["DEPLOYING", "LAUNCH_PLANNING", "FAILED"],
  // DEPLOYING never reaches FAILED directly: a failed EXECUTE attempt
  // reverts to AWAITING_LAUNCH_APPROVAL so the SAME already-approved
  // DeploymentPlan can be re-executed without a fresh approval (§39) —
  // never a silent retry loop, since every re-EXECUTE is its own,
  // fully human-triggered call.
  DEPLOYING: ["LIVE", "AWAITING_LAUNCH_APPROVAL"],
  LIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["LIVE", "ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  FAILED: ["ARCHIVED"],
  ARCHIVED: [],
};

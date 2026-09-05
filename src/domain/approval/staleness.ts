import { createHash } from "node:crypto";

/**
 * Change detection for a previously-APPROVED ApprovalRequest
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §39, M9 brief §27) — a
 * deterministic hash over a documented, per-resource-type field
 * subset, reusing node:crypto exactly like webhook-security.ts (M7)
 * already does (zero new dependency). Captured at approval-REQUEST
 * time; recomputed and compared at EXECUTE time. A mismatch means the
 * resource materially changed since the human approved it.
 */
export function computeResourceStateHash(fields: Readonly<Record<string, string | number | boolean | null>>): string {
  const ordered = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${String(fields[key])}`)
    .join("&");
  return createHash("sha256").update(ordered).digest("hex");
}

export interface ApprovalFreshnessInput {
  readonly expiresAt: Date | null;
  readonly now: Date;
  readonly approvedStateHash: string | null;
  readonly currentStateHash: string | null;
}

export type ApprovalStalenessReason = "EXPIRED" | "RESOURCE_CHANGED" | null;

/**
 * Pure decision function — the caller (a service, with DB access) is
 * responsible for actually transitioning the ApprovalRequest to
 * EXPIRED and throwing StaleApprovalError; this function only says
 * whether it should. `approvedStateHash`/`currentStateHash` are both
 * null for any ApprovalRequest created before this mechanism existed
 * (every M5/M7/M8 call site) — never treated as a mismatch, since
 * there is nothing to compare against.
 */
export function checkApprovalFreshness(input: ApprovalFreshnessInput): ApprovalStalenessReason {
  if (input.expiresAt !== null && input.expiresAt.getTime() < input.now.getTime()) {
    return "EXPIRED";
  }
  if (input.approvedStateHash !== null && input.currentStateHash !== null && input.approvedStateHash !== input.currentStateHash) {
    return "RESOURCE_CHANGED";
  }
  return null;
}

/** founder-revisable, matches the weekend cadence (docs/M9_ARCHITECTURE_PROPOSAL.md §38). */
export const DEFAULT_APPROVAL_EXPIRY_DAYS = 7;

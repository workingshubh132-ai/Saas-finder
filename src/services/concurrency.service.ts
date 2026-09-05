import { companyRecommendationRepository } from "../db/repositories/company-recommendation.repository.js";
import { isCompanyAction, type CompanyAction } from "../domain/company-action/company-action.types.js";
import { isConflictingAction } from "../domain/concurrency/concurrency.types.js";

export interface ConcurrencyCheckResult {
  readonly conflicting: boolean;
  readonly conflictingRecommendationId: string | null;
}

/**
 * Concurrency conflict detection (docs/M9_ARCHITECTURE_PROPOSAL.md §40,
 * M9 brief §28) — a read-time check with a human-visible flag, never a
 * database lock (docs/DECISIONS.md #61's "smallest correct model"
 * precedent: SQLite, WAL mode, one process). Wired into
 * `recommendCompanyAction` only (docs/DECISIONS.md's own M9 entry) —
 * the brief's own explicit instruction not to retrofit new governance
 * rules onto the five *existing*, already-shipped, already-tested CEO
 * axes, which keep their current behavior unchanged. On a real
 * conflict, the OLDER pending recommendation is never silently
 * superseded: this returns a flag, it never blocks or deletes
 * anything — both stay visible in the Human Decision Queue, and the
 * caller is responsible for making the conflict visible in what it
 * persists (never silently dropped).
 */
export const concurrencyService = {
  async checkCompanyRecommendationConflict(action: CompanyAction, targetOpportunityId: string | null, targetProductId: string | null): Promise<ConcurrencyCheckResult> {
    const pending = await companyRecommendationRepository.listUndecided();
    const conflict = pending.find(
      (r) => r.targetOpportunityId === targetOpportunityId && r.targetProductId === targetProductId && isCompanyAction(r.action) && isConflictingAction(r.action, action),
    );
    return { conflicting: conflict !== undefined, conflictingRecommendationId: conflict?.id ?? null };
  },
};

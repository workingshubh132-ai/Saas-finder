/**
 * "Count independent businesses, not messages" (Phase 6). This answers
 * a different question than `classifyIndependence`
 * (src/domain/claim/independence.ts, which grades how CONFIDENT a
 * given evidence set's independence is — KNOWN/LIKELY/UNKNOWN, for
 * evidence-quality scoring). Here the question is a plain count: how
 * many distinct organizations does this set of interactions represent.
 * A business is identified by `Prospect.organization` — three emails
 * from the same company, or two employees of the same company, both
 * collapse to one. A `null`/empty organization is dropped rather than
 * silently counted as one business (an unknown organization proves
 * nothing about independence).
 */
export function countIndependentBusinesses(organizations: readonly (string | null | undefined)[]): number {
  const distinct = new Set(organizations.filter((org): org is string => typeof org === "string" && org.trim().length > 0));
  return distinct.size;
}

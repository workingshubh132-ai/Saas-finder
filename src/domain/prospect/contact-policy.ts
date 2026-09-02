/**
 * Contact policy (docs/M5_ARCHITECTURE_PROPOSAL.md §9) — the ceiling a
 * Prospect can ever reach toward external communication. Set at the
 * OutreachExperiment level (inherited by every prospect discovered
 * under it) and independently tightenable per-Prospect, never
 * loosened below the experiment's own ceiling. No prospect reaches
 * APPROVED_TO_CONTACT (prospect.types.ts) while its effective policy
 * is anything other than APPROVED.
 */
export const CONTACT_POLICIES = ["NO_CONTACT", "RESEARCH_ONLY", "HUMAN_APPROVAL_REQUIRED", "APPROVED", "DO_NOT_CONTACT"] as const;
export type ContactPolicy = (typeof CONTACT_POLICIES)[number];

export function isContactPolicy(value: string): value is ContactPolicy {
  return (CONTACT_POLICIES as readonly string[]).includes(value);
}

/** Every OutreachExperiment defaults here — APPROVED is never a creation default, only reachable via an explicit, separate Human Owner action. */
export const DEFAULT_CONTACT_POLICY: ContactPolicy = "HUMAN_APPROVAL_REQUIRED";

/** A documented ranking so "policy A is at least as permissive as policy B" is a real, testable comparison, not a guess. DO_NOT_CONTACT is the floor; APPROVED is the ceiling below only nothing. */
const CONTACT_POLICY_RANK: Readonly<Record<ContactPolicy, number>> = {
  DO_NOT_CONTACT: 0,
  NO_CONTACT: 1,
  RESEARCH_ONLY: 2,
  HUMAN_APPROVAL_REQUIRED: 3,
  APPROVED: 4,
};

/** A prospect-level policy may never exceed (be more permissive than) its experiment's own ceiling. */
export function isWithinPolicyCeiling(prospectPolicy: ContactPolicy, experimentCeiling: ContactPolicy): boolean {
  return CONTACT_POLICY_RANK[prospectPolicy] <= CONTACT_POLICY_RANK[experimentCeiling];
}

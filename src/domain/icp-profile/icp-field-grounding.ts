import { z } from "zod";

/**
 * Per-ICP-field grounding the ICP Analyst reports alongside its
 * criteria (docs/M5_ARCHITECTURE_PROPOSAL.md §3) — mirrors M3's own
 * `dimensionGrounding` (domain/evidence-gap/dimension-grounding.ts)
 * one level richer: `groundedInClaimIds` names the REAL claims (if
 * any) that justify this specific criterion, so "ungrounded" (empty
 * array, status ASSUMED) is always distinguishable from "invented" —
 * the brief's own literal instruction ("do not let the model invent
 * arbitrary demographic assumptions"). A standalone domain file (not
 * defined inside icp-analyst.service.ts) so any future caller can
 * import the schema without a circular service dependency.
 *
 * "INFERRED" and `groundedInEvidenceIds` were added additively
 * alongside the original EVIDENCED|ASSUMED axis (Part 46): a field
 * whose value is a generalization derived from real Evidence — never
 * itself a claim, and never merely "no evidence either way" — needs a
 * third, honest state distinct from both. `groundedInEvidenceIds` is
 * optional and empty by default so every pre-existing EVIDENCED/ASSUMED
 * entry (claim-grounded only) remains valid unchanged.
 */
export const icpFieldGroundingSchema = z.array(
  z.object({
    field: z.string().min(1),
    groundedInClaimIds: z.array(z.string().min(1)),
    groundedInEvidenceIds: z.array(z.string().min(1)).optional(),
    status: z.enum(["EVIDENCED", "INFERRED", "ASSUMED"]),
    reasoning: z.string().min(1),
  }),
);
export type IcpFieldGrounding = z.infer<typeof icpFieldGroundingSchema>;

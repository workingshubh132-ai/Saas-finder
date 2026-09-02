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
 */
export const icpFieldGroundingSchema = z.array(
  z.object({
    field: z.string().min(1),
    groundedInClaimIds: z.array(z.string().min(1)),
    status: z.enum(["EVIDENCED", "ASSUMED"]),
    reasoning: z.string().min(1),
  }),
);
export type IcpFieldGrounding = z.infer<typeof icpFieldGroundingSchema>;

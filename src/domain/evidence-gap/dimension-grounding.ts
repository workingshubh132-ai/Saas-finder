import { z } from "zod";

/**
 * Per-score-dimension grounding the Opportunity Analyst reports
 * alongside its scores (docs/M3_ARCHITECTURE_PROPOSAL.md §9, §14) —
 * the raw input evidenceGapService.analyze() turns into EvidenceGap
 * rows and a ranked next-best-research-question. A standalone domain
 * file (not defined inside opportunity-analyst.service.ts or
 * evidence-gap.service.ts) specifically so both can import it without
 * a circular service dependency.
 */
export const dimensionGroundingSchema = z.array(
  z.object({
    dimension: z.string().min(1),
    status: z.enum(["EVIDENCED", "ASSUMED"]),
    reasoning: z.string().min(1),
  }),
);
export type DimensionGrounding = z.infer<typeof dimensionGroundingSchema>;

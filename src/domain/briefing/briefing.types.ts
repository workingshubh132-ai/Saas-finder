import { z } from "zod";

/**
 * Weekend Briefing (docs/M9_ARCHITECTURE_PROPOSAL.md §46, M9 brief
 * §34) — the brief's own eleven-section structure, verbatim order.
 * "Every important statement must be evidence-backed" is enforced
 * structurally: every statement object's own Zod schema requires a
 * non-empty citedIds array, so a section with nothing real to say
 * literally cannot be constructed with prose in it — see
 * NO_ACTION_REQUIRED (M9 brief §36) for the honest alternative.
 */
export const BRIEFING_SECTIONS = [
  "COMPANY",
  "PORTFOLIO",
  "REVENUE",
  "GROWTH",
  "RISKS",
  "OPPORTUNITIES",
  "EXPERIMENTS",
  "DECISIONS_REQUIRED",
  "CEO_TOP_RECOMMENDATIONS",
  "CHAIRMAN_CONCERNS",
  "LESSONS_FROM_LAST_PERIOD",
] as const;
export type BriefingSection = (typeof BRIEFING_SECTIONS)[number];

export function isBriefingSection(value: string): value is BriefingSection {
  return (BRIEFING_SECTIONS as readonly string[]).includes(value);
}

export const briefingStatementSchema = z.object({
  statement: z.string().min(1),
  citedIds: z.array(z.string().min(1)).min(1),
});
export type BriefingStatement = z.infer<typeof briefingStatementSchema>;

export const briefingContentSchema = z.object({
  COMPANY: z.array(briefingStatementSchema),
  PORTFOLIO: z.array(briefingStatementSchema),
  REVENUE: z.array(briefingStatementSchema),
  GROWTH: z.array(briefingStatementSchema),
  RISKS: z.array(briefingStatementSchema),
  OPPORTUNITIES: z.array(briefingStatementSchema),
  EXPERIMENTS: z.array(briefingStatementSchema),
  DECISIONS_REQUIRED: z.array(briefingStatementSchema),
  CEO_TOP_RECOMMENDATIONS: z.array(briefingStatementSchema),
  CHAIRMAN_CONCERNS: z.array(briefingStatementSchema),
  LESSONS_FROM_LAST_PERIOD: z.array(briefingStatementSchema),
  /** M9 brief §36 — a real, valid, honest output, not an edge case papered over. */
  status: z.enum(["ACTION_REQUIRED", "NO_ACTION_REQUIRED"]),
});
export type BriefingContent = z.infer<typeof briefingContentSchema>;

export function isEmptyBriefing(content: Pick<BriefingContent, "DECISIONS_REQUIRED">): boolean {
  return content.DECISIONS_REQUIRED.length === 0;
}

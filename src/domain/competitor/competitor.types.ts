/**
 * M3 brief Part 17. A CompetitorObservation is a single, timestamped,
 * evidence-linked note about a competitor made in the context of one
 * opportunity — never fabricated, always traceable to what a source
 * adapter actually returned (docs/M3_ARCHITECTURE_PROPOSAL.md §14).
 */
export const COMPETITOR_OBSERVATION_TYPES = [
  "PRICING",
  "POSITIONING",
  "REVIEW",
  "STRENGTH",
  "WEAKNESS",
  "MARKET_MATURITY",
] as const;
export type CompetitorObservationType = (typeof COMPETITOR_OBSERVATION_TYPES)[number];

export function isCompetitorObservationType(value: string): value is CompetitorObservationType {
  return (COMPETITOR_OBSERVATION_TYPES as readonly string[]).includes(value);
}

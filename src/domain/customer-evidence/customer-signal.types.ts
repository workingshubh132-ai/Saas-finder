/**
 * Customer signal types (docs/M5_ARCHITECTURE_PROPOSAL.md §16-17) —
 * distinct dimensions of customer feedback. Never collapse these:
 * "I have this problem" (PAIN/INTEREST) and "I would pay for this"
 * (WTP) are different claims about the world (brief §19/§20).
 */
export const CUSTOMER_SIGNAL_TYPES = [
  "PAIN",
  "FREQUENCY",
  "URGENCY",
  "CURRENT_WORKAROUND",
  "CURRENT_SPENDING",
  "WTP",
  "PURCHASE_AUTHORITY",
  "INTEREST",
  "OBJECTION",
  "ALTERNATIVE",
  "REQUEST",
  // Added for the customer-discovery-interaction boundary (docs/CUSTOMER_DISCOVERY_VALIDATION.md) —
  // structured findings from an interview/call that don't fit an existing type. Additive only:
  // every signal type above is unchanged in meaning and every existing routing entry is untouched.
  "WORKFLOW",
  "VOLUME",
  "TIME_COST",
  "CONSEQUENCE",
  "AUTOMATION_ATTEMPT",
] as const;
export type CustomerSignalType = (typeof CUSTOMER_SIGNAL_TYPES)[number];

export function isCustomerSignalType(value: string): value is CustomerSignalType {
  return (CUSTOMER_SIGNAL_TYPES as readonly string[]).includes(value);
}

/** LOW/MEDIUM/HIGH — reuses the same vocabulary EvidenceReliability already established, not a new scale. */
export const CUSTOMER_EVIDENCE_STRENGTHS = ["LOW", "MEDIUM", "HIGH"] as const;
export type CustomerEvidenceStrength = (typeof CUSTOMER_EVIDENCE_STRENGTHS)[number];

export function isCustomerEvidenceStrength(value: string): value is CustomerEvidenceStrength {
  return (CUSTOMER_EVIDENCE_STRENGTHS as readonly string[]).includes(value);
}

/** DIRECT (the customer said this themselves, about themselves) vs INFERRED (the Response Analyst read it between the lines). */
export const CUSTOMER_EVIDENCE_DIRECTNESS = ["DIRECT", "INFERRED"] as const;
export type CustomerEvidenceDirectness = (typeof CUSTOMER_EVIDENCE_DIRECTNESS)[number];

export function isCustomerEvidenceDirectness(value: string): value is CustomerEvidenceDirectness {
  return (CUSTOMER_EVIDENCE_DIRECTNESS as readonly string[]).includes(value);
}

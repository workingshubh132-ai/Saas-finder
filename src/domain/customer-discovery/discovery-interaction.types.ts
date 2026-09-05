import type { TransitionTable } from "../shared/state-machine.js";

/**
 * How a real discovery interaction reached VentureForge. Distinct from
 * (and broader than) CustomerResponse, which requires a prior
 * OutreachMessage this system itself sent — an EMAIL_REPLY to a message
 * sent manually outside the governed outbound path, an INTERVIEW, or a
 * CALL has no such message to point to.
 */
export const CUSTOMER_DISCOVERY_INTERACTION_TYPES = ["EMAIL_REPLY", "INTERVIEW", "CALL", "FORM_RESPONSE", "OTHER"] as const;
export type CustomerDiscoveryInteractionType = (typeof CUSTOMER_DISCOVERY_INTERACTION_TYPES)[number];

export function isCustomerDiscoveryInteractionType(value: string): value is CustomerDiscoveryInteractionType {
  return (CUSTOMER_DISCOVERY_INTERACTION_TYPES as readonly string[]).includes(value);
}

/**
 * A minimal two-state lifecycle, exactly mirroring
 * CUSTOMER_RESPONSE_STATUSES (RECEIVED -> ANALYZED): an interaction is
 * recorded, then (optionally) its structured findings are attached.
 */
export const CUSTOMER_DISCOVERY_INTERACTION_STATUSES = ["RECORDED", "ANALYZED"] as const;
export type CustomerDiscoveryInteractionStatus = (typeof CUSTOMER_DISCOVERY_INTERACTION_STATUSES)[number];

export function isCustomerDiscoveryInteractionStatus(value: string): value is CustomerDiscoveryInteractionStatus {
  return (CUSTOMER_DISCOVERY_INTERACTION_STATUSES as readonly string[]).includes(value);
}

export const CUSTOMER_DISCOVERY_INTERACTION_STATUS_TRANSITIONS: TransitionTable<CustomerDiscoveryInteractionStatus> = {
  RECORDED: ["ANALYZED"],
  ANALYZED: [],
};

/**
 * A deliberately small, structured outcome classification — mirrors
 * RESPONSE_CLASSIFICATIONS's own discipline of forcing a controlled
 * vocabulary rather than parsing free text. This is the ONE field the
 * deterministic validation engine reads to detect disqualifying
 * evidence (never by pattern-matching a free-text finding value).
 */
export const CUSTOMER_DISCOVERY_INTERACTION_OUTCOMES = [
  "PROBLEM_CONFIRMED",
  "PROBLEM_NOT_PRESENT",
  "ALREADY_SOLVED_ADEQUATELY",
  "INCONCLUSIVE",
] as const;
export type CustomerDiscoveryInteractionOutcome = (typeof CUSTOMER_DISCOVERY_INTERACTION_OUTCOMES)[number];

export function isCustomerDiscoveryInteractionOutcome(value: string): value is CustomerDiscoveryInteractionOutcome {
  return (CUSTOMER_DISCOVERY_INTERACTION_OUTCOMES as readonly string[]).includes(value);
}

/**
 * The brief's 12 structured-finding categories, plus one deliberate
 * addition: WILLINGNESS_TO_PAY. The brief's Phase 4 (WTP classification)
 * needs a concrete evidence field to classify from, and folding an
 * explicit "would you pay for this" statement into EXISTING_SPEND or
 * CONSEQUENCE would misrepresent what was actually said — so this is
 * 13 fields, not 12, and that one addition is called out here rather
 * than silently presented as one of "the 12."
 */
export const DISCOVERY_FINDING_FIELDS = [
  "PROBLEM_CONFIRMED",
  "WORKFLOW",
  "FREQUENCY",
  "VOLUME",
  "TIME_COST",
  "CURRENT_WORKAROUND",
  "CURRENT_TOOL",
  "EXISTING_SPEND",
  "CONSEQUENCE",
  "PREVIOUS_AUTOMATION_ATTEMPTS",
  "PRIORITY_URGENCY",
  "CUSTOMER_LANGUAGE",
  "WILLINGNESS_TO_PAY",
] as const;
export type DiscoveryFindingField = (typeof DISCOVERY_FINDING_FIELDS)[number];

export function isDiscoveryFindingField(value: string): value is DiscoveryFindingField {
  return (DISCOVERY_FINDING_FIELDS as readonly string[]).includes(value);
}

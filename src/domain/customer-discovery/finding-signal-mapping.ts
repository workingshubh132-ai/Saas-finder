import type { CustomerSignalType } from "../customer-evidence/customer-signal.types.js";
import type { DiscoveryFindingField } from "./discovery-interaction.types.js";

/**
 * Which CustomerSignalType (if any) a structured finding is promoted
 * to when it becomes real Evidence. A field absent from this map is
 * never auto-promoted — CUSTOMER_LANGUAGE is deliberately absent: a
 * standout verbatim quote is supporting color, not itself a structured
 * claim about one dimension, so it is recorded as a DiscoveryFinding
 * only and never spun into an Evidence row on its own.
 */
export const FINDING_FIELD_TO_SIGNAL_TYPE: Readonly<Partial<Record<DiscoveryFindingField, CustomerSignalType>>> = {
  PROBLEM_CONFIRMED: "PAIN",
  WORKFLOW: "WORKFLOW",
  FREQUENCY: "FREQUENCY",
  VOLUME: "VOLUME",
  TIME_COST: "TIME_COST",
  CURRENT_WORKAROUND: "CURRENT_WORKAROUND",
  CURRENT_TOOL: "CURRENT_WORKAROUND",
  EXISTING_SPEND: "CURRENT_SPENDING",
  CONSEQUENCE: "CONSEQUENCE",
  PREVIOUS_AUTOMATION_ATTEMPTS: "AUTOMATION_ATTEMPT",
  PRIORITY_URGENCY: "URGENCY",
  WILLINGNESS_TO_PAY: "WTP",
};

export function signalTypeForFindingField(field: DiscoveryFindingField): CustomerSignalType | null {
  return FINDING_FIELD_TO_SIGNAL_TYPE[field] ?? null;
}

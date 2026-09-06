/**
 * An OutreachExperiment-level discovery outcome (Design Requirement G)
 * — deliberately NOT a new response system: computed entirely from
 * data the existing M5 pipeline already records (CustomerResponse.status/
 * classification via responseAnalystService, CustomerEvidence.signalType
 * via the same). The point this closes: "no responses after N contacted"
 * is a distribution/outreach signal, never itself evidence the
 * underlying problem is false — silence and genuine disconfirmation
 * are different facts and must never collapse into one.
 */
export const EXPERIMENT_DISCOVERY_OUTCOMES = ["NO_RESPONSE", "PROBLEM_NOT_PRESENT", "PROBLEM_PRESENT", "PROBLEM_DIFFERENT", "ALREADY_SOLVED", "OTHER"] as const;
export type ExperimentDiscoveryOutcome = (typeof EXPERIMENT_DISCOVERY_OUTCOMES)[number];

export function isExperimentDiscoveryOutcome(value: string): value is ExperimentDiscoveryOutcome {
  return (EXPERIMENT_DISCOVERY_OUTCOMES as readonly string[]).includes(value);
}

/** Signal types a directly-described experience of the workflow's pain would produce (responseAnalystService's own CUSTOMER_SIGNAL_TYPES) — never WTP/PURCHASE_AUTHORITY, which are a different claim about the world entirely (customer-signal.types.ts's own docstring). */
const PAIN_SIGNAL_TYPES = new Set(["PAIN", "FREQUENCY", "URGENCY", "WORKFLOW", "TIME_COST", "CONSEQUENCE"]);
/** A customer already using something else to solve this. */
const ALREADY_SOLVED_SIGNAL_TYPES = new Set(["ALTERNATIVE", "CURRENT_WORKAROUND", "AUTOMATION_ATTEMPT"]);
const NEGATIVE_CLASSIFICATIONS = new Set(["NEGATIVE_SIGNAL", "NOT_INTERESTED"]);

export interface ResponseForOutcome {
  readonly status: string;
  readonly classification: string | null;
  /** This response's own extracted CustomerEvidence signal types (customerEvidenceRepository.listForResponse, mapped to .signalType). */
  readonly signalTypes: readonly string[];
}

/**
 * Deterministic — no model call, no new persistence. Silence
 * (zero analyzed responses) is reported as NO_RESPONSE, never silently
 * folded into PROBLEM_NOT_PRESENT: a founder reading NO_RESPONSE knows
 * to question distribution/targeting before questioning the
 * hypothesis itself.
 */
export function classifyExperimentDiscoveryOutcome(responses: readonly ResponseForOutcome[]): ExperimentDiscoveryOutcome {
  const analyzed = responses.filter((r) => r.status === "ANALYZED");
  if (analyzed.length === 0) return "NO_RESPONSE";

  if (analyzed.some((r) => r.signalTypes.some((t) => PAIN_SIGNAL_TYPES.has(t)))) return "PROBLEM_PRESENT";
  if (analyzed.some((r) => r.signalTypes.some((t) => ALREADY_SOLVED_SIGNAL_TYPES.has(t)))) return "ALREADY_SOLVED";
  if (analyzed.some((r) => r.classification === "NOISE" && r.signalTypes.length > 0)) return "PROBLEM_DIFFERENT";
  if (analyzed.some((r) => r.classification !== null && NEGATIVE_CLASSIFICATIONS.has(r.classification))) return "PROBLEM_NOT_PRESENT";

  return "OTHER";
}

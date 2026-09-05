import type { ResponseClassification } from "../customer-response/customer-response.types.js";

/**
 * The explicit customer-validation evidence ladder M10's brief Part 11
 * requires be defined BEFORE any building happens. Never treats likes,
 * views, "cool idea", poll votes, or generic interest as willingness to
 * pay (brief Part 11) — those cap out at WEAK/MEDIUM below, regardless
 * of how enthusiastic the wording is.
 */
export const CUSTOMER_VALIDATION_LEVELS = ["WEAK", "MEDIUM", "STRONG", "VERY_STRONG", "EXTREMELY_STRONG"] as const;
export type CustomerValidationLevel = (typeof CUSTOMER_VALIDATION_LEVELS)[number];

export function isCustomerValidationLevel(value: string): value is CustomerValidationLevel {
  return (CUSTOMER_VALIDATION_LEVELS as readonly string[]).includes(value);
}

const LEVEL_RANK: Readonly<Record<CustomerValidationLevel, number>> = {
  WEAK: 0,
  MEDIUM: 1,
  STRONG: 2,
  VERY_STRONG: 3,
  EXTREMELY_STRONG: 4,
};

export function meetsLevel(actual: CustomerValidationLevel, required: CustomerValidationLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/**
 * Build Gate minimum (brief Part 12): never build because the CEO likes
 * it, the opportunity score is high, or the Chairman approves — only
 * because real customer evidence clears this bar. VERY_STRONG (a real
 * agreement to trial) is the floor; EXTREMELY_STRONG (agreement to pay)
 * is strictly stronger evidence, not a separate, higher gate.
 */
export const BUILD_GATE_MINIMUM_LEVEL: CustomerValidationLevel = "VERY_STRONG";

/**
 * Deliberately structured-input, not sentiment-inferred: whether a
 * customer "described the problem" or "explained their current
 * workaround" is a fact an operator (human, or a Response Analyst
 * agent reading the actual text) records explicitly, never guessed from
 * a coarser sentiment label alone — the same "never fabricate, always
 * cite" discipline as every other classification in this codebase.
 * `classification` alone can only ever produce WEAK or MEDIUM; STRONG
 * and above require an explicit, independently-recorded fact.
 */
export interface CustomerValidationSignals {
  readonly classification: ResponseClassification;
  readonly describesCurrentWorkaround: boolean;
  readonly agreedToTrial: boolean;
  readonly agreedToPay: boolean;
}

const ENGAGED_CLASSIFICATIONS: ReadonlySet<ResponseClassification> = new Set(["INTEREST", "POSITIVE_SIGNAL", "REQUEST_FOR_DETAILS", "QUESTION"]);

export function classifyValidationLevel(signals: CustomerValidationSignals): CustomerValidationLevel {
  if (signals.agreedToPay) return "EXTREMELY_STRONG";
  if (signals.agreedToTrial) return "VERY_STRONG";
  if (signals.describesCurrentWorkaround) return "STRONG";
  if (ENGAGED_CLASSIFICATIONS.has(signals.classification)) return "MEDIUM";
  return "WEAK";
}

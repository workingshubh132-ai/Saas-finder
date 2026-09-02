import type { TransitionTable } from "../shared/state-machine.js";

/**
 * Response classification (docs/M5_ARCHITECTURE_PROPOSAL.md §15) —
 * the brief's own ten values, exactly. UNCLEAR is a first-class,
 * honest outcome, never avoided by forcing a positive/negative read
 * (mirrors M4's INSUFFICIENT_EVIDENCE discipline).
 */
export const RESPONSE_CLASSIFICATIONS = [
  "POSITIVE_SIGNAL",
  "NEGATIVE_SIGNAL",
  "NEUTRAL",
  "QUESTION",
  "OBJECTION",
  "REQUEST_FOR_DETAILS",
  "INTEREST",
  "NOT_INTERESTED",
  "NOISE",
  "UNCLEAR",
] as const;
export type ResponseClassification = (typeof RESPONSE_CLASSIFICATIONS)[number];

export function isResponseClassification(value: string): value is ResponseClassification {
  return (RESPONSE_CLASSIFICATIONS as readonly string[]).includes(value);
}

/** A minimal two-step lifecycle — a response is recorded, then analyzed. No customer-feedback-specific state machine beyond this (docs/M5_ARCHITECTURE_PROPOSAL.md §19). */
export const CUSTOMER_RESPONSE_STATUSES = ["RECEIVED", "ANALYZED"] as const;
export type CustomerResponseStatus = (typeof CUSTOMER_RESPONSE_STATUSES)[number];

export function isCustomerResponseStatus(value: string): value is CustomerResponseStatus {
  return (CUSTOMER_RESPONSE_STATUSES as readonly string[]).includes(value);
}

export const CUSTOMER_RESPONSE_STATUS_TRANSITIONS: TransitionTable<CustomerResponseStatus> = {
  RECEIVED: ["ANALYZED"],
  ANALYZED: [],
};

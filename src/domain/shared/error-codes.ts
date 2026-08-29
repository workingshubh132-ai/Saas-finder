/**
 * The shared error taxonomy every material failure in VentureForge is
 * classified into (M2 brief Part 25). Used both for HTTP error
 * responses (`error-handler.ts`) and for `AgentExecution.errorCode` —
 * one vocabulary, not two parallel ones.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "TOOL_ERROR",
  "MODEL_ERROR",
  "TIMEOUT",
  "RATE_LIMIT",
  "BUDGET_EXCEEDED",
  "DOMAIN_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

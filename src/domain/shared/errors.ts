import type { ErrorCode } from "./error-codes.js";

export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: ErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly errorCode: ErrorCode = "DOMAIN_ERROR";

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly errorCode: ErrorCode = "VALIDATION_ERROR";
}

/** Thrown when the caller presents no, an invalid, or a revoked/expired credential. */
export class AuthenticationError extends DomainError {
  readonly statusCode = 401;
  readonly errorCode: ErrorCode = "AUTHENTICATION_ERROR";
}

/** Thrown by the authorization service when a request is flatly denied. */
export class AuthorizationDeniedError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: ErrorCode = "AUTHORIZATION_ERROR";
}

/** Thrown when a human decision endpoint is called by the same identity that requested it. */
export class SelfApprovalError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: ErrorCode = "AUTHORIZATION_ERROR";

  constructor() {
    super("An agent's own requester cannot review its approval request.");
  }
}

/** Thrown when the caller is not a verified HUMAN-type identity. */
export class NotHumanOwnerError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: ErrorCode = "AUTHORIZATION_ERROR";

  constructor(identity: string) {
    super(`"${identity}" is not a verified Human Owner identity.`);
  }
}

export class InvalidTransitionError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode: ErrorCode = "DOMAIN_ERROR";

  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
  }
}

/** A registered Tool's execute() failed (network, non-2xx response, malformed output). */
export class ToolError extends DomainError {
  readonly statusCode = 502;
  readonly errorCode: ErrorCode = "TOOL_ERROR";
}

/** A ModelProvider call failed, or its output could not be validated after the one bounded retry. */
export class ModelError extends DomainError {
  readonly statusCode = 502;
  readonly errorCode: ErrorCode = "MODEL_ERROR";
}

export class TimeoutError extends DomainError {
  readonly statusCode = 504;
  readonly errorCode: ErrorCode = "TIMEOUT";
}

export class RateLimitError extends DomainError {
  readonly statusCode = 429;
  readonly errorCode: ErrorCode = "RATE_LIMIT";
}

/** An AgentExecution hit one of its bounded limits (steps, tool calls, model calls, time, cost). */
export class BudgetExceededError extends DomainError {
  readonly statusCode = 429;
  readonly errorCode: ErrorCode = "BUDGET_EXCEEDED";
}

/**
 * M9 — docs/M9_ARCHITECTURE_PROPOSAL.md §38-39. Thrown by
 * assertApprovalNotStale for either reason a previously-APPROVED
 * ApprovalRequest may no longer be safe to execute: its own expiresAt
 * has passed, or the underlying resource materially changed since the
 * approval was granted (a state-hash mismatch). Both share one error
 * type — both answer the same question ("is this approval still good
 * for what's about to happen") — the message says which.
 */
export class StaleApprovalError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode: ErrorCode = "DOMAIN_ERROR";
}

/**
 * M9 — docs/M9_ARCHITECTURE_PROPOSAL.md §40. Thrown when a second,
 * still-pending CeoRecommendation for the same resource conflicts with
 * an earlier one still awaiting a human decision. Never silently
 * resolved — both approvals are frozen until a human explicitly picks
 * one via resolveConcurrentConflict.
 */
export class ConcurrentConflictError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode: ErrorCode = "DOMAIN_ERROR";
}

/**
 * M9 — docs/M9_ARCHITECTURE_PROPOSAL.md §46, §57. Thrown by every
 * stage-advance and EXECUTE call site while the company-wide
 * EmergencyStop is active. Fails closed: an error checking the stop's
 * own state is treated as this error, never as "the stop is inactive."
 */
export class EmergencyStopActiveError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode: ErrorCode = "AUTHORIZATION_ERROR";

  constructor() {
    super("Company-wide emergency stop is active — no new consequential execution may start until a human resumes it.");
  }
}

/**
 * Autonomous Operations Phase A hardening — thrown when a provider
 * factory's REAL mode is explicitly requested but no real provider
 * implementation exists to satisfy it. Never a signal to fall back to
 * a DEV_FIXTURE provider — REAL must mean real, or fail closed.
 */
export class ProviderNotConfiguredError extends DomainError {
  readonly statusCode = 503;
  readonly errorCode: ErrorCode = "DOMAIN_ERROR";

  constructor(providerName: string) {
    super(`${providerName} is configured for REAL mode, but no real provider implementation exists in this deployment — refusing to fall back to DEV_FIXTURE.`);
  }
}

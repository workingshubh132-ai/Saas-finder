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

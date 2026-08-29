export abstract class DomainError extends Error {
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
}

/** Thrown by the authorization service when a request is flatly denied. */
export class AuthorizationDeniedError extends DomainError {
  readonly statusCode = 403;
}

/** Thrown when a human decision endpoint is called by the same identity that requested it. */
export class SelfApprovalError extends DomainError {
  readonly statusCode = 403;

  constructor() {
    super("An agent's own requester cannot review its approval request.");
  }
}

/** Thrown when the caller is not a recognized Human Owner identity. */
export class NotHumanOwnerError extends DomainError {
  readonly statusCode = 403;

  constructor(identity: string) {
    super(`"${identity}" is not a recognized Human Owner identity.`);
  }
}

export class InvalidTransitionError extends DomainError {
  readonly statusCode = 409;

  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
  }
}

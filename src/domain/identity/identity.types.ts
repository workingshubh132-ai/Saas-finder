/** The three actor kinds the M2 brief (Part 3) requires distinguishing. */
export const IDENTITY_TYPES = ["HUMAN", "AGENT", "SYSTEM"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export function isIdentityType(value: string): value is IdentityType {
  return (IDENTITY_TYPES as readonly string[]).includes(value);
}

export const IDENTITY_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export function isIdentityStatus(value: string): value is IdentityStatus {
  return (IDENTITY_STATUSES as readonly string[]).includes(value);
}

/** The resolved, verified caller of a request — never trust a lookalike shape built from request body fields. */
export interface AuthenticatedActor {
  readonly type: IdentityType;
  /** For AGENT, this is the linked Agent's id (not the Identity's own id) — see M2_ARCHITECTURE_PROPOSAL.md §6. */
  readonly id: string;
  readonly identityId: string;
}

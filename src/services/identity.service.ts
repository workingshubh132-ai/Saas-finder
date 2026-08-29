import type { Identity } from "@prisma/client";
import { agentRepository } from "../db/repositories/agent.repository.js";
import { identityRepository } from "../db/repositories/identity.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { isIdentityType } from "../domain/identity/identity.types.js";
import { AuthenticationError, NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { generateToken, hashToken } from "../domain/shared/tokens.js";
import { auditService } from "./audit.service.js";

export interface CreateIdentityParams {
  type: string;
  label: string;
  agentId?: string | null;
  expiresAt?: Date | null;
  /** null only for the one-time bootstrap of the first HUMAN identity. */
  createdBy: AuthenticatedActor | null;
}

export interface CreatedIdentity {
  identity: Identity;
  /** Shown to the caller exactly once — the service never returns this again. */
  token: string;
}

/**
 * Real, minimal authentication (M2_ARCHITECTURE_PROPOSAL.md §6): opaque
 * bearer tokens, hashed at rest, resolved to a verified HUMAN/AGENT/
 * SYSTEM actor. No passwords, no sessions, no JWTs — the smallest thing
 * that replaces M1's caller-supplied actor strings with something a
 * caller cannot simply assert.
 */
export const identityService = {
  async createIdentity(params: CreateIdentityParams): Promise<CreatedIdentity> {
    if (!isIdentityType(params.type)) {
      throw new ValidationError(`Unknown identity type: ${params.type}`);
    }

    const isBootstrap = (await identityRepository.countAll()) === 0;
    if (isBootstrap) {
      if (params.type !== "HUMAN") {
        throw new ValidationError("The first identity in a fresh deployment must be type HUMAN (bootstrap).");
      }
    } else if (!params.createdBy || params.createdBy.type !== "HUMAN") {
      throw new AuthenticationError(
        "Creating an identity requires an authenticated HUMAN identity, except for the one-time bootstrap.",
      );
    }

    if (params.type === "AGENT") {
      if (!params.agentId) throw new ValidationError("An AGENT identity requires agentId.");
      const agent = await agentRepository.findById(params.agentId);
      if (!agent) throw new NotFoundError("Agent", params.agentId);
    }

    const generated = generateToken();
    const identity = await identityRepository.create({
      type: params.type,
      label: params.label,
      agentId: params.type === "AGENT" ? (params.agentId ?? null) : null,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
      createdByIdentityId: params.createdBy?.identityId ?? null,
      expiresAt: params.expiresAt ?? null,
    });

    await auditService.record({
      actorType: params.createdBy?.type ?? "SYSTEM",
      actorId: params.createdBy?.id ?? null,
      action: "CREATE_IDENTITY",
      resourceType: "IDENTITY",
      resourceId: identity.id,
      result: "SUCCESS",
      metadata: { type: params.type, bootstrap: isBootstrap },
    });

    return { identity, token: generated.token };
  },

  async authenticate(rawToken: string): Promise<AuthenticatedActor> {
    const identity = await identityRepository.findByTokenHash(hashToken(rawToken));
    if (!identity) throw new AuthenticationError("Invalid credential.");
    if (identity.status !== "ACTIVE") throw new AuthenticationError("Credential has been revoked.");
    if (identity.expiresAt && identity.expiresAt.getTime() < Date.now()) {
      throw new AuthenticationError("Credential has expired.");
    }

    // Best-effort telemetry; must never block or fail authentication itself.
    identityRepository.touchLastUsed(identity.id).catch(() => undefined);

    if (identity.type === "AGENT") {
      if (!identity.agentId) throw new AuthenticationError("Malformed AGENT identity (no linked agent).");
      return { type: "AGENT", id: identity.agentId, identityId: identity.id };
    }
    if (identity.type === "HUMAN" || identity.type === "SYSTEM") {
      return { type: identity.type, id: identity.id, identityId: identity.id };
    }
    // Fail closed on a corrupted/unrecognized stored type rather than guessing.
    throw new AuthenticationError(`Unrecognized identity type on record: ${identity.type}`);
  },

  async revokeIdentity(params: { id: string; revokedBy: AuthenticatedActor }): Promise<Identity> {
    if (params.revokedBy.type !== "HUMAN") {
      throw new AuthenticationError("Revoking an identity requires an authenticated HUMAN identity.");
    }
    const identity = await identityRepository.findById(params.id);
    if (!identity) throw new NotFoundError("Identity", params.id);

    const updated = await identityRepository.revoke(params.id);
    await auditService.record({
      actorType: "HUMAN",
      actorId: params.revokedBy.id,
      action: "REVOKE_IDENTITY",
      resourceType: "IDENTITY",
      resourceId: params.id,
      result: "SUCCESS",
    });
    return updated;
  },

  listIdentities: identityRepository.list,
};

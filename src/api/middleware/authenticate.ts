import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedActor } from "../../domain/identity/identity.types.js";
import { AuthenticationError, NotHumanOwnerError } from "../../domain/shared/errors.js";
import type { Actor } from "../../services/agent.service.js";
import { identityService } from "../../services/identity.service.js";

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match ? (match[1] ?? null) : null;
}

async function resolveActor(req: Request): Promise<AuthenticatedActor> {
  const token = extractBearerToken(req.header("authorization"));
  if (!token) throw new AuthenticationError("Missing bearer token.");
  return identityService.authenticate(token);
}

/** Any verified identity (HUMAN, AGENT, or SYSTEM) may proceed. */
export function requireAuth() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    resolveActor(req)
      .then((actor) => {
        req.actor = actor;
        next();
      })
      .catch(next);
  };
}

/**
 * Only a verified HUMAN identity may proceed — for privileged,
 * Human-Owner-only actions. A non-HUMAN caller is still a *successfully
 * authenticated* identity (we know exactly who it is), so being turned
 * away here is an authorization failure (403), not an authentication
 * one (401) — NotHumanOwnerError, not AuthenticationError.
 */
export function requireHuman() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    resolveActor(req)
      .then((actor) => {
        if (actor.type !== "HUMAN") {
          throw new NotHumanOwnerError(actor.id);
        }
        req.actor = actor;
        next();
      })
      .catch(next);
  };
}

/**
 * For the one endpoint that must behave differently for a genuinely
 * anonymous caller (no header at all — eligible for bootstrap) versus
 * a caller presenting a bad credential (still rejected loudly, never
 * silently treated as anonymous): returns null only when no
 * Authorization header was sent at all.
 */
export async function tryAuthenticate(req: Request): Promise<AuthenticatedActor | null> {
  if (!req.header("authorization")) return null;
  return resolveActor(req);
}

/** Reads the actor a prior requireAuth()/requireHuman() call attached to the request. Fails closed if neither ran. */
export function getActor(req: Request): AuthenticatedActor {
  if (!req.actor) {
    throw new AuthenticationError("No authenticated actor on request — route is missing requireAuth()/requireHuman().");
  }
  return req.actor;
}

/** Bridges the verified AuthenticatedActor to the M1 Actor shape most services already take. */
export function toActor(actor: AuthenticatedActor): Actor {
  return { actorType: actor.type, actorId: actor.id };
}

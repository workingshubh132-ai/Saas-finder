import type { AuthenticatedActor } from "../../domain/identity/identity.types.js";

declare global {
  // Required shape for Express request augmentation — no alternative syntax.
  namespace Express {
    interface Request {
      /** Set by requireAuth()/requireHuman() once the bearer token is verified. */
      actor?: AuthenticatedActor;
    }
  }
}

export {};

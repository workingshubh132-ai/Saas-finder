import { Router } from "express";
import { z } from "zod";
import { identityService } from "../../services/identity.service.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { getActor, requireAuth, requireHuman, tryAuthenticate } from "../middleware/authenticate.js";
import { requireParam } from "../middleware/params.js";
import { validateBody } from "../middleware/validate.js";

export const identitiesRouter = Router();

const createIdentitySchema = z.object({
  type: z.enum(["HUMAN", "AGENT", "SYSTEM"]),
  label: z.string().min(1),
  agentId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * No blanket auth middleware: bootstrapping the very first HUMAN
 * identity in a fresh deployment must work unauthenticated (there is
 * nothing to authenticate against yet), but every call after that is
 * required — by identityService.createIdentity itself — to come from
 * a verified HUMAN. A caller who *does* present a token is always
 * authenticated against it (an invalid token is rejected loudly, never
 * silently treated as anonymous); only a fully absent header is
 * eligible for the bootstrap path.
 */
identitiesRouter.post(
  "/",
  validateBody(createIdentitySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createIdentitySchema>;
    const createdBy = await tryAuthenticate(req);

    const result = await identityService.createIdentity({
      type: body.type,
      label: body.label,
      agentId: body.agentId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdBy,
    });

    res.status(201).json({
      id: result.identity.id,
      type: result.identity.type,
      label: result.identity.label,
      agentId: result.identity.agentId,
      tokenPrefix: result.identity.tokenPrefix,
      createdAt: result.identity.createdAt,
      // Shown exactly once — never returned by any other endpoint.
      token: result.token,
    });
  }),
);

identitiesRouter.get(
  "/me",
  requireAuth(),
  asyncHandler(async (req, res) => {
    res.json({ actor: getActor(req) });
  }),
);

/** Human-Owner administration view. Never includes tokenHash — only the display-safe prefix. */
identitiesRouter.get(
  "/",
  requireHuman(),
  asyncHandler(async (_req, res) => {
    const identities = await identityService.listIdentities();
    res.json(
      identities.map((identity) => ({
        id: identity.id,
        type: identity.type,
        label: identity.label,
        agentId: identity.agentId,
        tokenPrefix: identity.tokenPrefix,
        status: identity.status,
        createdAt: identity.createdAt,
        lastUsedAt: identity.lastUsedAt,
        expiresAt: identity.expiresAt,
      })),
    );
  }),
);

identitiesRouter.post(
  "/:id/revoke",
  requireHuman(),
  asyncHandler(async (req, res) => {
    const updated = await identityService.revokeIdentity({ id: requireParam(req, "id"), revokedBy: getActor(req) });
    res.json({ id: updated.id, status: updated.status, revokedAt: updated.revokedAt });
  }),
);

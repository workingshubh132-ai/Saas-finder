import type { Identity } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateIdentityInput {
  type: string;
  label: string;
  agentId: string | null;
  tokenHash: string;
  tokenPrefix: string;
  createdByIdentityId: string | null;
  expiresAt: Date | null;
}

export const identityRepository = {
  create(input: CreateIdentityInput): Promise<Identity> {
    return prisma.identity.create({ data: input });
  },

  findById(id: string): Promise<Identity | null> {
    return prisma.identity.findUnique({ where: { id } });
  },

  findByTokenHash(tokenHash: string): Promise<Identity | null> {
    return prisma.identity.findUnique({ where: { tokenHash } });
  },

  countAll(): Promise<number> {
    return prisma.identity.count();
  },

  revoke(id: string): Promise<Identity> {
    return prisma.identity.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
  },

  touchLastUsed(id: string): Promise<Identity> {
    return prisma.identity.update({ where: { id }, data: { lastUsedAt: new Date() } });
  },

  list(): Promise<Identity[]> {
    return prisma.identity.findMany({ orderBy: { createdAt: "desc" } });
  },
};

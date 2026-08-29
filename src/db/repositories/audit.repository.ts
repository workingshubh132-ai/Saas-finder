import type { AuditLog } from "@prisma/client";
import { prisma } from "../client.js";

export interface RecordAuditInput {
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  riskLevel: string | null;
  result: string;
  reason: string | null;
  metadata: string | null;
}

/**
 * Append-only by construction: this module exports no update or delete
 * function, and nothing outside it may import `prisma.auditLog`
 * directly (see eslint restricted-imports in the future, or a DB-role
 * grant, once M1 moves off a single-process SQLite file — see
 * docs/SECURITY.md for why that enforcement isn't in place yet).
 */
export const auditRepository = {
  record(input: RecordAuditInput): Promise<AuditLog> {
    return prisma.auditLog.create({ data: input });
  },

  list(filter: { resourceType?: string; resourceId?: string; actorId?: string; limit?: number } = {}): Promise<
    AuditLog[]
  > {
    return prisma.auditLog.findMany({
      where: {
        resourceType: filter.resourceType,
        resourceId: filter.resourceId,
        actorId: filter.actorId,
      },
      orderBy: { timestamp: "desc" },
      take: filter.limit ?? 200,
    });
  },
};

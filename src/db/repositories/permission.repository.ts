import type { AgentPermission } from "@prisma/client";
import { prisma } from "../client.js";

export interface GrantPermissionInput {
  agentId: string;
  permission: string;
  grantedBy: string;
  reason: string | null;
}

export const agentPermissionRepository = {
  grant(input: GrantPermissionInput): Promise<AgentPermission> {
    return prisma.agentPermission.create({ data: input });
  },

  findById(id: string): Promise<AgentPermission | null> {
    return prisma.agentPermission.findUnique({ where: { id } });
  },

  revoke(id: string, revokedBy: string): Promise<AgentPermission> {
    return prisma.agentPermission.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy },
    });
  },

  listActiveForAgent(agentId: string): Promise<AgentPermission[]> {
    return prisma.agentPermission.findMany({ where: { agentId, revokedAt: null } });
  },

  async hasActivePermission(agentId: string, permission: string): Promise<boolean> {
    const count = await prisma.agentPermission.count({
      where: { agentId, permission, revokedAt: null },
    });
    return count > 0;
  },
};

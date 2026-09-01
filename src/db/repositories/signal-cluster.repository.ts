import type { SignalCluster } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateClusterInput {
  name: string;
  summary: string;
}

export interface UpdateClusterInput {
  signalCount?: number;
  independentSourceCount?: number;
  confidence?: number;
  status?: string;
}

export const signalClusterRepository = {
  create(input: CreateClusterInput): Promise<SignalCluster> {
    return prisma.signalCluster.create({ data: input });
  },

  findById(id: string): Promise<SignalCluster | null> {
    return prisma.signalCluster.findUnique({ where: { id } });
  },

  /** Bounded candidate set for assignment comparison (docs/M3_ARCHITECTURE_PROPOSAL.md §45's fan-out warning). */
  listActive(limit: number): Promise<SignalCluster[]> {
    return prisma.signalCluster.findMany({ where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: limit });
  },

  update(id: string, data: UpdateClusterInput): Promise<SignalCluster> {
    return prisma.signalCluster.update({ where: { id }, data });
  },

  list(filter: { status?: string } = {}): Promise<SignalCluster[]> {
    return prisma.signalCluster.findMany({ where: { status: filter.status }, orderBy: { createdAt: "desc" } });
  },
};

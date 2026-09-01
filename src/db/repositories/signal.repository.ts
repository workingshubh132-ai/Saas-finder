import type { Signal } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateSignalInput {
  source: string;
  sourceType: string;
  sourceReference: string;
  title: string;
  content: string;
  collectedByAgentId: string;
  publishedAt: Date | null;
  authorContext: string | null;
  language: string;
  contentHash: string;
  sourceGroupKey: string | null;
  metadata: string | null;
  reliability: string;
  qualityScore: number;
  status: string;
  duplicateOfSignalId: string | null;
  duplicateReason: string | null;
}

export interface UpdateSignalInput {
  status?: string;
  clusterId?: string | null;
}

export const signalRepository = {
  create(input: CreateSignalInput): Promise<Signal> {
    return prisma.signal.create({ data: input });
  },

  findById(id: string): Promise<Signal | null> {
    return prisma.signal.findUnique({ where: { id } });
  },

  /** Exact-duplicate lookup (§5) — global, not scoped to one source: the same story can be crossposted. */
  findByContentHash(contentHash: string): Promise<Signal | null> {
    return prisma.signal.findFirst({ where: { contentHash }, orderBy: { createdAt: "asc" } });
  },

  /** Source-repost lookup (§5) — same canonical URL already ingested. */
  findBySourceReference(sourceReference: string): Promise<Signal | null> {
    return prisma.signal.findFirst({ where: { sourceReference }, orderBy: { createdAt: "asc" } });
  },

  /** Bounded window for near-duplicate/clustering comparison — recent,
   *  non-duplicate signals from the same source, not the whole table
   *  (docs/M3_ARCHITECTURE_PROPOSAL.md §5, Part 45's N x M x K warning). */
  listRecentComparable(source: string, limit: number): Promise<Signal[]> {
    return prisma.signal.findMany({
      where: { source, status: { in: ["NEW", "PROCESSED", "CLUSTERED"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  update(id: string, data: UpdateSignalInput): Promise<Signal> {
    return prisma.signal.update({ where: { id }, data });
  },

  list(filter: { status?: string; clusterId?: string } = {}): Promise<Signal[]> {
    return prisma.signal.findMany({
      where: { status: filter.status, clusterId: filter.clusterId },
      orderBy: { createdAt: "desc" },
    });
  },

  listByCluster(clusterId: string): Promise<Signal[]> {
    return prisma.signal.findMany({ where: { clusterId }, orderBy: { createdAt: "asc" } });
  },
};

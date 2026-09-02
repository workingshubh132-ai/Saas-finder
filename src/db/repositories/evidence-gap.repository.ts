import type { EvidenceGap } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateEvidenceGapInput {
  opportunityId: string;
  dimension: string;
  status: string;
  description: string;
  suggestedResearchQuestion: string;
  impactScore: number;
  /** M4 — set for a claim-level gap (docs/M4_ARCHITECTURE_PROPOSAL.md §15); omitted/null keeps the original M3 dimension-level path unchanged. */
  claimId?: string | null;
}

export interface UpdateEvidenceGapInput {
  status?: string;
  description?: string;
  suggestedResearchQuestion?: string;
  impactScore?: number;
}

export const evidenceGapRepository = {
  create(input: CreateEvidenceGapInput): Promise<EvidenceGap> {
    return prisma.evidenceGap.create({ data: input });
  },

  findById(id: string): Promise<EvidenceGap | null> {
    return prisma.evidenceGap.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<EvidenceGap[]> {
    return prisma.evidenceGap.findMany({ where: { opportunityId }, orderBy: { impactScore: "desc" } });
  },

  listUnresolvedForOpportunity(opportunityId: string): Promise<EvidenceGap[]> {
    return prisma.evidenceGap.findMany({
      where: { opportunityId, status: { not: "RESOLVED" } },
      orderBy: { impactScore: "desc" },
    });
  },

  /** M4 — the one unresolved gap already tracking this claim, if any (docs/M4_ARCHITECTURE_PROPOSAL.md §15): refreshed in place rather than duplicated on every re-validation. */
  findUnresolvedByClaimId(claimId: string): Promise<EvidenceGap | null> {
    return prisma.evidenceGap.findFirst({ where: { claimId, status: { not: "RESOLVED" } } });
  },

  update(id: string, data: UpdateEvidenceGapInput): Promise<EvidenceGap> {
    return prisma.evidenceGap.update({ where: { id }, data });
  },

  resolve(id: string, resolvedByEvidenceId: string | null): Promise<EvidenceGap> {
    return prisma.evidenceGap.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByEvidenceId },
    });
  },
};

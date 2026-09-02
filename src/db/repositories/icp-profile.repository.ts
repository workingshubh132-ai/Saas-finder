import type { IcpProfile } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateIcpProfileInput {
  opportunityId: string;
  industry: string;
  companySizeMin: number | null;
  companySizeMax: number | null;
  role: string;
  problemExposure: string;
  likelyFrequency: string;
  geography: string;
  technology: string;
  /** JSON-encoded string[]. */
  exclusions: string;
  /** JSON-encoded IcpFieldGrounding. */
  fieldGrounding: string;
  generatedByAgentId: string;
}

/** Historized like opportunity-score-record.repository.ts's own OpportunityScoreRecord — no update method, a refined ICP is a new row (docs/M5_ARCHITECTURE_PROPOSAL.md §3, §33). */
export const icpProfileRepository = {
  create(input: CreateIcpProfileInput): Promise<IcpProfile> {
    return prisma.icpProfile.create({ data: input });
  },

  findById(id: string): Promise<IcpProfile | null> {
    return prisma.icpProfile.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<IcpProfile[]> {
    return prisma.icpProfile.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForOpportunity(opportunityId: string): Promise<IcpProfile | null> {
    return prisma.icpProfile.findFirst({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },
};

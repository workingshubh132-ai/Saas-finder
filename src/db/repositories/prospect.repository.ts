import type { Prospect } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProspectInput {
  opportunityId: string;
  icpProfileId: string | null;
  organization: string;
  role: string;
  publicContactChannel: string;
  source: string;
  sourceUrl: string;
  discoveredByAgentId: string;
}

export interface UpdateProspectQualificationInput {
  qualificationStatus: string;
  icpFit: string;
  reasonForMatch: string;
  /** JSON-encoded string[]. */
  unknowns: string;
  status: string;
}

export const prospectRepository = {
  create(input: CreateProspectInput): Promise<Prospect> {
    return prisma.prospect.create({ data: input });
  },

  findById(id: string): Promise<Prospect | null> {
    return prisma.prospect.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<Prospect[]> {
    return prisma.prospect.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
  },

  listForIcpProfile(icpProfileId: string): Promise<Prospect[]> {
    return prisma.prospect.findMany({ where: { icpProfileId }, orderBy: { createdAt: "asc" } });
  },

  updateQualification(id: string, data: UpdateProspectQualificationInput): Promise<Prospect> {
    return prisma.prospect.update({ where: { id }, data });
  },

  updateStatus(id: string, status: string): Promise<Prospect> {
    return prisma.prospect.update({ where: { id }, data: { status } });
  },
};

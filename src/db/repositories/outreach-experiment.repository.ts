import type { OutreachExperiment } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateOutreachExperimentInput {
  opportunityId: string;
  objective: string;
  claimId: string;
  targetIcpProfileId: string;
  researchQuestion: string;
  messageStrategy: string;
  prospectLimit: number;
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  successCriteria: string;
  failureCriteria: string;
  contactPolicy: string;
  createdByIdentityId: string;
}

export const outreachExperimentRepository = {
  create(input: CreateOutreachExperimentInput): Promise<OutreachExperiment> {
    return prisma.outreachExperiment.create({ data: input });
  },

  findById(id: string): Promise<OutreachExperiment | null> {
    return prisma.outreachExperiment.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<OutreachExperiment[]> {
    return prisma.outreachExperiment.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  countActiveForOpportunity(opportunityId: string): Promise<number> {
    return prisma.outreachExperiment.count({ where: { opportunityId, status: "ACTIVE" } });
  },

  approve(id: string, approvedByIdentityId: string, approvedAt: Date): Promise<OutreachExperiment> {
    return prisma.outreachExperiment.update({ where: { id }, data: { status: "ACTIVE", approvedByIdentityId, approvedAt } });
  },

  updateStatus(id: string, status: string): Promise<OutreachExperiment> {
    return prisma.outreachExperiment.update({ where: { id }, data: { status } });
  },
};

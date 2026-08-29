import type { Evidence, Opportunity, OpportunityEvidence, OpportunityScoreRecord } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateOpportunityInput {
  title: string;
  problem: string;
  targetCustomer: string;
  description: string;
  metadata: string | null;
}

export interface UpdateOpportunityInput {
  status?: string;
  validationLevel?: string;
  opportunityScore?: number | null;
  confidenceScore?: number | null;
}

export interface AddScoreRecordInput {
  opportunityId: string;
  dimensions: string;
  opportunityScore: number;
  confidenceScore: number;
  scoredBy: string;
}

export const opportunityRepository = {
  create(input: CreateOpportunityInput): Promise<Opportunity> {
    return prisma.opportunity.create({ data: input });
  },

  findById(id: string): Promise<Opportunity | null> {
    return prisma.opportunity.findUnique({ where: { id } });
  },

  update(id: string, data: UpdateOpportunityInput): Promise<Opportunity> {
    return prisma.opportunity.update({ where: { id }, data });
  },

  list(filter: { status?: string } = {}): Promise<Opportunity[]> {
    return prisma.opportunity.findMany({
      where: { status: filter.status },
      orderBy: { createdAt: "desc" },
    });
  },

  attachEvidence(opportunityId: string, evidenceId: string): Promise<OpportunityEvidence> {
    return prisma.opportunityEvidence.create({ data: { opportunityId, evidenceId } });
  },

  async listEvidence(opportunityId: string): Promise<Evidence[]> {
    const links = await prisma.opportunityEvidence.findMany({
      where: { opportunityId },
      include: { evidence: true },
      orderBy: { createdAt: "asc" },
    });
    return links.map((link) => link.evidence);
  },

  countEvidence(opportunityId: string): Promise<number> {
    return prisma.opportunityEvidence.count({ where: { opportunityId } });
  },

  addScoreRecord(input: AddScoreRecordInput): Promise<OpportunityScoreRecord> {
    return prisma.opportunityScoreRecord.create({ data: input });
  },

  listScoreRecords(opportunityId: string): Promise<OpportunityScoreRecord[]> {
    return prisma.opportunityScoreRecord.findMany({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
    });
  },
};

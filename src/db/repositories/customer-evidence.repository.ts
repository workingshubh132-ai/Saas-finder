import type { CustomerEvidence } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCustomerEvidenceInput {
  responseId: string;
  evidenceId: string;
  prospectId: string;
  signalType: string;
  relatedClaimType: string | null;
  strength: string;
  directness: string;
  extractedByAgentId: string;
}

/** Append-only, no status (docs/M5_ARCHITECTURE_PROPOSAL.md §19) — matches ClaimEvidence's own append-only-no-status precedent (M4). */
export const customerEvidenceRepository = {
  create(input: CreateCustomerEvidenceInput): Promise<CustomerEvidence> {
    return prisma.customerEvidence.create({ data: input });
  },

  findById(id: string): Promise<CustomerEvidence | null> {
    return prisma.customerEvidence.findUnique({ where: { id } });
  },

  findByEvidenceId(evidenceId: string): Promise<CustomerEvidence | null> {
    return prisma.customerEvidence.findFirst({ where: { evidenceId } });
  },

  listForOpportunity(opportunityId: string): Promise<CustomerEvidence[]> {
    return prisma.customerEvidence.findMany({ where: { prospect: { opportunityId } }, orderBy: { createdAt: "asc" } });
  },

  listForResponse(responseId: string): Promise<CustomerEvidence[]> {
    return prisma.customerEvidence.findMany({ where: { responseId }, orderBy: { createdAt: "asc" } });
  },
};

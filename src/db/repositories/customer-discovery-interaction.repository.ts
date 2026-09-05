import type { CustomerDiscoveryInteraction } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCustomerDiscoveryInteractionInput {
  opportunityId: string;
  prospectId: string;
  outreachMessageId: string | null;
  interactionType: string;
  interactionDate: Date;
  channel: string | null;
  participantRole: string | null;
  rawNotes: string;
  reality: string;
  provenanceNote: string;
  recordedByIdentityId: string;
}

/** rawNotes is immutable once recorded — no update method touches it, mirroring CustomerResponse.rawContent. */
export const customerDiscoveryInteractionRepository = {
  create(input: CreateCustomerDiscoveryInteractionInput): Promise<CustomerDiscoveryInteraction> {
    return prisma.customerDiscoveryInteraction.create({ data: input });
  },

  findById(id: string): Promise<CustomerDiscoveryInteraction | null> {
    return prisma.customerDiscoveryInteraction.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<CustomerDiscoveryInteraction[]> {
    return prisma.customerDiscoveryInteraction.findMany({ where: { opportunityId }, orderBy: { interactionDate: "asc" } });
  },

  listForProspect(prospectId: string): Promise<CustomerDiscoveryInteraction[]> {
    return prisma.customerDiscoveryInteraction.findMany({ where: { prospectId }, orderBy: { interactionDate: "asc" } });
  },

  setOutcome(id: string, interactionOutcome: string): Promise<CustomerDiscoveryInteraction> {
    return prisma.customerDiscoveryInteraction.update({ where: { id }, data: { status: "ANALYZED", interactionOutcome } });
  },
};

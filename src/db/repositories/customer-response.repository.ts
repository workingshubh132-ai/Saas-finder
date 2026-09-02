import type { CustomerResponse } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateCustomerResponseInput {
  outreachMessageId: string;
  prospectId: string;
  rawContent: string;
  enteredByIdentityId: string;
}

/** rawContent is immutable once recorded (docs/M5_ARCHITECTURE_PROPOSAL.md §14) — no update method touches it. */
export const customerResponseRepository = {
  create(input: CreateCustomerResponseInput): Promise<CustomerResponse> {
    return prisma.customerResponse.create({ data: input });
  },

  findById(id: string): Promise<CustomerResponse | null> {
    return prisma.customerResponse.findUnique({ where: { id } });
  },

  listForProspect(prospectId: string): Promise<CustomerResponse[]> {
    return prisma.customerResponse.findMany({ where: { prospectId }, orderBy: { recordedAt: "asc" } });
  },

  listForExperiment(experimentId: string): Promise<CustomerResponse[]> {
    return prisma.customerResponse.findMany({ where: { outreachMessage: { experimentId } }, orderBy: { recordedAt: "asc" } });
  },

  markAnalyzed(id: string, classification: string): Promise<CustomerResponse> {
    return prisma.customerResponse.update({ where: { id }, data: { status: "ANALYZED", classification, analyzedAt: new Date() } });
  },
};

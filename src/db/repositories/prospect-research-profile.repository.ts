import type { ProspectResearchProfile } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProspectResearchProfileInput {
  prospectId: string;
  businessName: string;
  industry: string;
  location: string;
  website: string;
  contactType: string;
  contactSource: string;
  decisionMaker: string;
  workflowSignals: string;
  painHypotheses: string;
  confidence: number;
  reality: string;
  provenanceNote: string;
  createdByAgentId: string;
}

/** Append-only, one row per Prospect — no update method exists. */
export const prospectResearchProfileRepository = {
  create(input: CreateProspectResearchProfileInput): Promise<ProspectResearchProfile> {
    return prisma.prospectResearchProfile.create({ data: input });
  },

  findByProspectId(prospectId: string): Promise<ProspectResearchProfile | null> {
    return prisma.prospectResearchProfile.findUnique({ where: { prospectId } });
  },

  listForOpportunity(opportunityId: string): Promise<ProspectResearchProfile[]> {
    return prisma.prospectResearchProfile.findMany({ where: { prospect: { opportunityId } }, orderBy: { createdAt: "asc" } });
  },
};

import type { DiscoveryFinding } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateDiscoveryFindingInput {
  interactionId: string;
  field: string;
  provenance: string;
  value: string;
  evidenceQuote: string | null;
}

/** Append-only, no status — matches ClaimEvidence's/CustomerEvidence's own append-only precedent. */
export const discoveryFindingRepository = {
  create(input: CreateDiscoveryFindingInput): Promise<DiscoveryFinding> {
    return prisma.discoveryFinding.create({ data: input });
  },

  findById(id: string): Promise<DiscoveryFinding | null> {
    return prisma.discoveryFinding.findUnique({ where: { id } });
  },

  listForInteraction(interactionId: string): Promise<DiscoveryFinding[]> {
    return prisma.discoveryFinding.findMany({ where: { interactionId }, orderBy: { createdAt: "asc" } });
  },

  listForOpportunity(opportunityId: string): Promise<DiscoveryFinding[]> {
    return prisma.discoveryFinding.findMany({ where: { interaction: { opportunityId } }, orderBy: { createdAt: "asc" } });
  },

  markPromoted(id: string, evidenceId: string): Promise<DiscoveryFinding> {
    return prisma.discoveryFinding.update({ where: { id }, data: { promotedToEvidenceId: evidenceId } });
  },
};

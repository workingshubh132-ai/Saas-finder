import type { MvpArchitecture } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateMvpArchitectureInput {
  productId: string;
  productSpecId: string;
  designJson: string;
  generatedByAgentId: string;
}

/**
 * Historized, with exactly one legal follow-up update: the UX Agent
 * fills in the `ux` section of the same row the MVP Architect just
 * created (docs/M6_ARCHITECTURE_PROPOSAL.md §9's own compile-then-complete
 * shape, mirroring CustomerDiscoveryMemo/ProductReviewMemo's own
 * "starts incomplete, completed by exactly one later call" precedent —
 * never a general-purpose mutable record).
 */
export const mvpArchitectureRepository = {
  create(input: CreateMvpArchitectureInput): Promise<MvpArchitecture> {
    return prisma.mvpArchitecture.create({ data: input });
  },

  findById(id: string): Promise<MvpArchitecture | null> {
    return prisma.mvpArchitecture.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<MvpArchitecture | null> {
    return prisma.mvpArchitecture.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  setDesignJson(id: string, designJson: string): Promise<MvpArchitecture> {
    return prisma.mvpArchitecture.update({ where: { id }, data: { designJson } });
  },
};

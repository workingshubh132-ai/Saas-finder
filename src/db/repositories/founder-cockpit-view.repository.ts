import type { FounderCockpitView } from "@prisma/client";
import { prisma } from "../client.js";

export const founderCockpitViewRepository = {
  record(viewedByIdentityId: string): Promise<FounderCockpitView> {
    return prisma.founderCockpitView.create({ data: { viewedByIdentityId } });
  },

  findLatest(): Promise<FounderCockpitView | null> {
    return prisma.founderCockpitView.findFirst({ orderBy: { viewedAt: "desc" } });
  },
};

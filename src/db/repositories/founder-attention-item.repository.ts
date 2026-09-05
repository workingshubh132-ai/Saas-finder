import type { FounderAttentionItem } from "@prisma/client";
import { NotFoundError } from "../../domain/shared/errors.js";
import { prisma } from "../client.js";

export interface CreateFounderAttentionItemInput {
  resourceType: string;
  resourceId: string;
  sourceKind: string;
  source: string;
  score: number;
  factors: string;
  summary: string;
}

export const founderAttentionItemRepository = {
  create(input: CreateFounderAttentionItemInput): Promise<FounderAttentionItem> {
    return prisma.founderAttentionItem.create({ data: input });
  },

  findById(id: string): Promise<FounderAttentionItem | null> {
    return prisma.founderAttentionItem.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<FounderAttentionItem> {
    const item = await prisma.founderAttentionItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundError("FounderAttentionItem", id);
    return item;
  },

  /** One open (unreviewed) item per (resourceType, resourceId, source) — the refresh's own dedup check. */
  findOpenForResource(resourceType: string, resourceId: string, source: string): Promise<FounderAttentionItem | null> {
    return prisma.founderAttentionItem.findFirst({ where: { resourceType, resourceId, source, reviewedAt: null } });
  },

  listUnreviewed(): Promise<FounderAttentionItem[]> {
    return prisma.founderAttentionItem.findMany({ where: { reviewedAt: null }, orderBy: { score: "desc" } });
  },

  markReviewed(id: string): Promise<FounderAttentionItem> {
    return prisma.founderAttentionItem.update({ where: { id }, data: { reviewedAt: new Date() } });
  },
};

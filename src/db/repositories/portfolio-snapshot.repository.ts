import type { PortfolioSnapshot } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreatePortfolioSnapshotInput {
  productId: string;
  runId: string;
  revenueUsd: number;
  growthRatePct: number;
  retentionPct: number;
  marginPct: number;
  evidenceConfidence: number;
  killRiskScore: number;
  priorityScore: number;
  recommendation: string;
  reasoning: string;
  citedMetricIds: string;
}

export const portfolioSnapshotRepository = {
  create(input: CreatePortfolioSnapshotInput): Promise<PortfolioSnapshot> {
    return prisma.portfolioSnapshot.create({ data: input });
  },

  listForRun(runId: string): Promise<PortfolioSnapshot[]> {
    return prisma.portfolioSnapshot.findMany({ where: { runId }, orderBy: { priorityScore: "desc" } });
  },

  listForProduct(productId: string): Promise<PortfolioSnapshot[]> {
    return prisma.portfolioSnapshot.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForProduct(productId: string): Promise<PortfolioSnapshot | null> {
    return prisma.portfolioSnapshot.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },
};

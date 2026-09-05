import type { GrowthExperiment } from "@prisma/client";
import { prisma } from "../client.js";
import { NotFoundError } from "../../domain/shared/errors.js";

export interface CreateGrowthExperimentInput {
  productId: string;
  claimId: string;
  hypothesis: string;
  interventionDescription: string;
  controlDescription: string;
  targetMetricType: string;
  successCriteria: string;
  failureCriteria: string;
  estimatedCostUsd: number;
  riskLevel: string;
  durationDays: number;
}

export const growthExperimentRepository = {
  create(input: CreateGrowthExperimentInput): Promise<GrowthExperiment> {
    return prisma.growthExperiment.create({ data: input });
  },

  findById(id: string): Promise<GrowthExperiment | null> {
    return prisma.growthExperiment.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<GrowthExperiment> {
    const experiment = await prisma.growthExperiment.findUnique({ where: { id } });
    if (!experiment) throw new NotFoundError("GrowthExperiment", id);
    return experiment;
  },

  listForProduct(productId: string): Promise<GrowthExperiment[]> {
    return prisma.growthExperiment.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  /** Cross-product (docs/M9_ARCHITECTURE_PROPOSAL.md §46's own EXPERIMENTS briefing section). */
  list(filter: { status?: string } = {}): Promise<GrowthExperiment[]> {
    return prisma.growthExperiment.findMany({ where: { status: filter.status }, orderBy: { createdAt: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<GrowthExperiment> {
    return prisma.growthExperiment.update({ where: { id }, data: { status } });
  },

  setApprovalRequest(id: string, approvalRequestId: string): Promise<GrowthExperiment> {
    return prisma.growthExperiment.update({ where: { id }, data: { approvalRequestId } });
  },

  markStarted(id: string): Promise<GrowthExperiment> {
    return prisma.growthExperiment.update({ where: { id }, data: { status: "RUNNING", startedAt: new Date() } });
  },

  markEnded(id: string, status: "COMPLETED" | "FAILED"): Promise<GrowthExperiment> {
    return prisma.growthExperiment.update({ where: { id }, data: { status, endedAt: new Date() } });
  },
};

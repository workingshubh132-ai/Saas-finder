import type { Product } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateProductInput {
  opportunityId: string;
  createdByIdentityId: string;
}

export const productRepository = {
  create(input: CreateProductInput): Promise<Product> {
    return prisma.product.create({ data: input });
  },

  findById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  },

  findByOpportunityId(opportunityId: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { opportunityId } });
  },

  updateStatus(id: string, status: string): Promise<Product> {
    return prisma.product.update({ where: { id }, data: { status } });
  },

  approve(id: string, approvedByIdentityId: string): Promise<Product> {
    return prisma.product.update({ where: { id }, data: { status: "APPROVED", approvedByIdentityId, approvedAt: new Date() } });
  },

  setWorkspacePath(id: string, workspacePath: string): Promise<Product> {
    return prisma.product.update({ where: { id }, data: { workspacePath } });
  },

  setCostEstimates(id: string, input: { estimatedDevelopmentCostUsd?: number | null; estimatedOperatingCostUsd?: number | null }): Promise<Product> {
    return prisma.product.update({ where: { id }, data: input });
  },

  setDeploymentArtifacts(id: string, input: { deploymentPlan: string; rollbackPlan: string }): Promise<Product> {
    return prisma.product.update({ where: { id }, data: input });
  },

  list(): Promise<Product[]> {
    return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  },
};

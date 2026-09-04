import type { DeploymentPlan } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateDeploymentPlanInput {
  productId: string;
  environment: string;
  provider: string;
  strategy: string;
  estimatedCostUsd: number;
  rollbackPlan: string;
  artifactRef: string;
  budgetExceeded: boolean;
}

/** Immutable once created (docs/M7_ARCHITECTURE_PROPOSAL.md §16-17) — no content-editing method exists here, only status transitions. */
export const deploymentPlanRepository = {
  create(input: CreateDeploymentPlanInput): Promise<DeploymentPlan> {
    return prisma.deploymentPlan.create({ data: { ...input, status: "DRAFT" } });
  },

  findById(id: string): Promise<DeploymentPlan | null> {
    return prisma.deploymentPlan.findUnique({ where: { id } });
  },

  findLatestForProduct(productId: string): Promise<DeploymentPlan | null> {
    return prisma.deploymentPlan.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },

  updateStatus(id: string, status: string): Promise<DeploymentPlan> {
    return prisma.deploymentPlan.update({ where: { id }, data: { status } });
  },

  attachApprovalRequest(id: string, approvalRequestId: string): Promise<DeploymentPlan> {
    return prisma.deploymentPlan.update({ where: { id }, data: { approvalRequestId, status: "PENDING_APPROVAL" } });
  },
};

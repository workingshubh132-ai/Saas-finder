import type { Deployment } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateDeploymentInput {
  deploymentPlanId: string;
  provider: string;
  environment: string;
  status: string;
  providerRef: string;
  detail: string;
  rolledBackFromId?: string | null;
  deployedByIdentityId: string;
  deployedAt: Date;
}

/** Created already in its terminal status, never mutated afterward (docs/M7_ARCHITECTURE_PROPOSAL.md §16-18). */
export const deploymentRepository = {
  create(input: CreateDeploymentInput): Promise<Deployment> {
    return prisma.deployment.create({ data: input });
  },

  findById(id: string): Promise<Deployment | null> {
    return prisma.deployment.findUnique({ where: { id } });
  },

  findLatestForPlan(deploymentPlanId: string): Promise<Deployment | null> {
    return prisma.deployment.findFirst({ where: { deploymentPlanId }, orderBy: { deployedAt: "desc" } });
  },

  /** Whether `deploymentId` has already been superseded by a rollback row — the real staleness check, since the original row's own status is never mutated (docs/M7_ARCHITECTURE_PROPOSAL.md §18). */
  findRollbackOf(deploymentId: string): Promise<Deployment | null> {
    return prisma.deployment.findFirst({ where: { rolledBackFromId: deploymentId } });
  },

  listForPlan(deploymentPlanId: string): Promise<Deployment[]> {
    return prisma.deployment.findMany({ where: { deploymentPlanId }, orderBy: { deployedAt: "desc" } });
  },
};

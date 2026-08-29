import type { ApprovalRequest } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateApprovalRequestInput {
  requestedByAgentId: string;
  action: string;
  description: string;
  riskLevel: string;
  resourceType: string | null;
  resourceId: string | null;
  evidence: string | null;
  reason: string | null;
  expiresAt: Date | null;
}

export interface DecideApprovalInput {
  status: string;
  reviewedBy: string;
  decisionReason: string | null;
}

export const approvalRepository = {
  create(input: CreateApprovalRequestInput): Promise<ApprovalRequest> {
    return prisma.approvalRequest.create({ data: input });
  },

  findById(id: string): Promise<ApprovalRequest | null> {
    return prisma.approvalRequest.findUnique({ where: { id } });
  },

  decide(id: string, input: DecideApprovalInput): Promise<ApprovalRequest> {
    return prisma.approvalRequest.update({
      where: { id },
      data: { ...input, reviewedAt: new Date() },
    });
  },

  /** Re-queue a deferred request (REQUEST_MORE_EVIDENCE round-trip). */
  requeue(id: string): Promise<ApprovalRequest> {
    return prisma.approvalRequest.update({
      where: { id },
      data: { status: "PENDING", reviewedBy: null, reviewedAt: null, decisionReason: null },
    });
  },

  listQueue(): Promise<ApprovalRequest[]> {
    return prisma.approvalRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
  },

  listByResource(resourceType: string, resourceId: string): Promise<ApprovalRequest[]> {
    return prisma.approvalRequest.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: "desc" },
    });
  },
};

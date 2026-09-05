import type { ApprovalSnapshot } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateApprovalSnapshotInput {
  approvalRequestId: string;
  resourceType: string;
  resourceId: string;
  stateHash: string;
}

export const approvalSnapshotRepository = {
  create(input: CreateApprovalSnapshotInput): Promise<ApprovalSnapshot> {
    return prisma.approvalSnapshot.create({ data: input });
  },

  findByApprovalRequestId(approvalRequestId: string): Promise<ApprovalSnapshot | null> {
    return prisma.approvalSnapshot.findUnique({ where: { approvalRequestId } });
  },
};

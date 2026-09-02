import type { OutreachMessage } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateOutreachMessageInput {
  experimentId: string;
  prospectId: string;
  content: string;
  reasoning: string;
  claimBeingTestedId: string;
  expectedInformationGain: number;
  draftedByAgentId: string;
}

/**
 * Deliberately no update method for content/reasoning/prospectId/experimentId
 * (docs/M5_ARCHITECTURE_PROPOSAL.md §12) — the structural enforcement
 * of "approved message A cannot become modified message B without new
 * approval." Only status/approval/contact bookkeeping ever changes
 * after creation.
 */
export const outreachMessageRepository = {
  create(input: CreateOutreachMessageInput): Promise<OutreachMessage> {
    return prisma.outreachMessage.create({ data: input });
  },

  findById(id: string): Promise<OutreachMessage | null> {
    return prisma.outreachMessage.findUnique({ where: { id } });
  },

  listForExperiment(experimentId: string): Promise<OutreachMessage[]> {
    return prisma.outreachMessage.findMany({ where: { experimentId }, orderBy: { createdAt: "asc" } });
  },

  countForExperimentSince(experimentId: string, since: Date): Promise<number> {
    return prisma.outreachMessage.count({ where: { experimentId, createdAt: { gte: since } } });
  },

  countForDestinationSince(experimentId: string, publicContactChannel: string, since: Date): Promise<number> {
    return prisma.outreachMessage.count({
      where: { experimentId, createdAt: { gte: since }, prospect: { publicContactChannel } },
    });
  },

  updateStatus(id: string, status: string): Promise<OutreachMessage> {
    return prisma.outreachMessage.update({ where: { id }, data: { status } });
  },

  attachApprovalRequest(id: string, approvalRequestId: string): Promise<OutreachMessage> {
    return prisma.outreachMessage.update({ where: { id }, data: { approvalRequestId, status: "AWAITING_HUMAN_APPROVAL" } });
  },

  markContacted(id: string, contactedByIdentityId: string, contactedAt: Date): Promise<OutreachMessage> {
    return prisma.outreachMessage.update({ where: { id }, data: { status: "CONTACTED", contactedByIdentityId, contactedAt } });
  },
};

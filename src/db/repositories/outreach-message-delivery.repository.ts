import type { OutreachMessageDelivery } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateOutreachMessageDeliveryInput {
  outreachMessageId: string;
  provider: string;
  status: string;
  providerRef: string;
  detail: string;
  sentByIdentityId: string;
  sentAt: Date;
}

export const outreachMessageDeliveryRepository = {
  create(input: CreateOutreachMessageDeliveryInput): Promise<OutreachMessageDelivery> {
    return prisma.outreachMessageDelivery.create({ data: input });
  },

  /** Idempotency read (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) — a prior SENT row means outboundMessageService.send() must never call the provider again for this message. */
  findLatestForMessage(outreachMessageId: string): Promise<OutreachMessageDelivery | null> {
    return prisma.outreachMessageDelivery.findFirst({ where: { outreachMessageId }, orderBy: { sentAt: "desc" } });
  },

  listForMessage(outreachMessageId: string): Promise<OutreachMessageDelivery[]> {
    return prisma.outreachMessageDelivery.findMany({ where: { outreachMessageId }, orderBy: { sentAt: "asc" } });
  },
};

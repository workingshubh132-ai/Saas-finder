import type { WebhookDelivery } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateWebhookDeliveryInput {
  billingAccountId: string;
  provider: string;
  deliveryId: string;
  signatureValid: boolean;
  eventType: string;
}

/** Idempotency + replay-protection record for every inbound billing webhook (docs/M7_ARCHITECTURE_PROPOSAL.md §20). */
export const webhookDeliveryRepository = {
  create(input: CreateWebhookDeliveryInput): Promise<WebhookDelivery> {
    return prisma.webhookDelivery.create({ data: input });
  },

  findByProviderAndDeliveryId(provider: string, deliveryId: string): Promise<WebhookDelivery | null> {
    return prisma.webhookDelivery.findUnique({ where: { provider_deliveryId: { provider, deliveryId } } });
  },
};

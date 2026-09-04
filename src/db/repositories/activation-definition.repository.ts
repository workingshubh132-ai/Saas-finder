import type { ActivationDefinition } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateActivationDefinitionInput {
  productId: string;
  eventName: string;
  definedBy: string;
}

export const activationDefinitionRepository = {
  create(input: CreateActivationDefinitionInput): Promise<ActivationDefinition> {
    return prisma.activationDefinition.create({ data: input });
  },

  findLatestForProduct(productId: string): Promise<ActivationDefinition | null> {
    return prisma.activationDefinition.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  },
};

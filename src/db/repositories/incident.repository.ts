import type { Incident } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateIncidentInput {
  productId: string;
  deploymentId?: string | null;
  severity: string;
  summary: string;
}

export interface UpdateIncidentStatusExtra {
  postmortem?: string | null;
  resolvedAt?: Date | null;
}

/** DETECTED -> ... -> POSTMORTEM (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §26). */
export const incidentRepository = {
  create(input: CreateIncidentInput): Promise<Incident> {
    return prisma.incident.create({ data: { ...input, status: "DETECTED" } });
  },

  findById(id: string): Promise<Incident | null> {
    return prisma.incident.findUnique({ where: { id } });
  },

  listForProduct(productId: string): Promise<Incident[]> {
    return prisma.incident.findMany({ where: { productId }, orderBy: { detectedAt: "desc" } });
  },

  updateStatus(id: string, status: string, extra: UpdateIncidentStatusExtra = {}): Promise<Incident> {
    return prisma.incident.update({ where: { id }, data: { status, ...extra } });
  },
};

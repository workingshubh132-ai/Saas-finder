import type { Alert } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateAlertInput {
  alertType: string;
  severity: string;
  resourceType: string;
  resourceId: string;
  message: string;
  score: number;
}

export const alertRepository = {
  create(input: CreateAlertInput): Promise<Alert> {
    return prisma.alert.create({ data: input });
  },

  /** Most recent alert for this exact (alertType, resourceType, resourceId) — the dedup service's own lookup. */
  findMostRecentForKey(alertType: string, resourceType: string, resourceId: string): Promise<Alert | null> {
    return prisma.alert.findFirst({ where: { alertType, resourceType, resourceId }, orderBy: { lastSeenAt: "desc" } });
  },

  bumpOccurrence(id: string, lastSeenAt: Date): Promise<Alert> {
    return prisma.alert.update({ where: { id }, data: { occurrenceCount: { increment: 1 }, lastSeenAt } });
  },

  acknowledge(id: string, acknowledgedByIdentityId: string, acknowledgedAt: Date): Promise<Alert> {
    return prisma.alert.update({ where: { id }, data: { acknowledgedAt, acknowledgedByIdentityId } });
  },

  listUnacknowledged(): Promise<Alert[]> {
    return prisma.alert.findMany({ where: { acknowledgedAt: null }, orderBy: { score: "desc" } });
  },

  list(): Promise<Alert[]> {
    return prisma.alert.findMany({ orderBy: { lastSeenAt: "desc" } });
  },
};

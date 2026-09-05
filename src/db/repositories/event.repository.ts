import type { Event } from "@prisma/client";
import { prisma } from "../client.js";

export interface AppendEventInput {
  type: string;
  payload: string;
}

export const eventRepository = {
  append(input: AppendEventInput): Promise<Event> {
    return prisma.event.create({ data: input });
  },

  list(filter: { type?: string; limit?: number; since?: Date } = {}): Promise<Event[]> {
    return prisma.event.findMany({
      where: { type: filter.type, occurredAt: filter.since ? { gte: filter.since } : undefined },
      orderBy: { occurredAt: "desc" },
      take: filter.limit ?? 100,
    });
  },
};

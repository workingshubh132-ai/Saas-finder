import type { EmergencyStop } from "@prisma/client";
import { prisma } from "../client.js";

export const emergencyStopRepository = {
  findActive(): Promise<EmergencyStop | null> {
    return prisma.emergencyStop.findFirst({ where: { resumedAt: null }, orderBy: { activatedAt: "desc" } });
  },

  create(input: { activatedByIdentityId: string }): Promise<EmergencyStop> {
    return prisma.emergencyStop.create({ data: input });
  },

  resume(id: string, resumedByIdentityId: string): Promise<EmergencyStop> {
    return prisma.emergencyStop.update({ where: { id }, data: { resumedAt: new Date(), resumedByIdentityId } });
  },

  list(): Promise<EmergencyStop[]> {
    return prisma.emergencyStop.findMany({ orderBy: { activatedAt: "desc" } });
  },
};

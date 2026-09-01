import type { Competitor, CompetitorObservation } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateObservationInput {
  competitorId: string;
  problemId: string;
  type: string;
  detail: string;
  sourceReference: string | null;
}

export type ObservationWithCompetitor = CompetitorObservation & { competitor: Competitor };

export const competitorRepository = {
  /** Case-sensitive exact-name match — see docs/SOURCE_ADAPTERS.md /
   *  docs/M3_ARCHITECTURE_PROPOSAL.md §16 for why fuzzy competitor
   *  resolution is a deliberate M4 deferral, not an oversight. */
  async findOrCreateByName(name: string, url: string | null): Promise<Competitor> {
    const existing = await prisma.competitor.findFirst({ where: { name } });
    if (existing) return existing;
    return prisma.competitor.create({ data: { name, url, description: null } });
  },

  findById(id: string): Promise<Competitor | null> {
    return prisma.competitor.findUnique({ where: { id } });
  },

  list(): Promise<Competitor[]> {
    return prisma.competitor.findMany({ orderBy: { name: "asc" } });
  },

  addObservation(input: CreateObservationInput): Promise<CompetitorObservation> {
    return prisma.competitorObservation.create({ data: input });
  },

  listObservationsForProblem(problemId: string): Promise<ObservationWithCompetitor[]> {
    return prisma.competitorObservation.findMany({
      where: { problemId },
      include: { competitor: true },
      orderBy: { observedAt: "desc" },
    });
  },
};

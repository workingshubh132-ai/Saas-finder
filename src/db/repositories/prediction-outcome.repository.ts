import type { PredictionOutcome } from "@prisma/client";
import { prisma } from "../client.js";
import { NotFoundError } from "../../domain/shared/errors.js";

export interface CreatePredictionOutcomeInput {
  productId: string;
  metricType: string;
  predictedValue: number;
  predictedAt: Date;
  targetPeriodStart: Date;
  targetPeriodEnd: Date;
  predictionSource: string;
}

export const predictionOutcomeRepository = {
  create(input: CreatePredictionOutcomeInput): Promise<PredictionOutcome> {
    return prisma.predictionOutcome.create({ data: input });
  },

  findById(id: string): Promise<PredictionOutcome | null> {
    return prisma.predictionOutcome.findUnique({ where: { id } });
  },

  async getOrThrow(id: string): Promise<PredictionOutcome> {
    const outcome = await prisma.predictionOutcome.findUnique({ where: { id } });
    if (!outcome) throw new NotFoundError("PredictionOutcome", id);
    return outcome;
  },

  /** Resolved (observedValue set) but whose target period has actually elapsed — never earlier (no future-information leakage). */
  listUnresolvedPastTarget(now: Date): Promise<PredictionOutcome[]> {
    return prisma.predictionOutcome.findMany({ where: { observedValue: null, targetPeriodEnd: { lte: now } } });
  },

  resolve(id: string, observedValue: number, errorPct: number | null, resolvedAt: Date): Promise<PredictionOutcome> {
    return prisma.predictionOutcome.update({ where: { id }, data: { observedValue, errorPct, resolvedAt } });
  },

  listForProduct(productId: string): Promise<PredictionOutcome[]> {
    return prisma.predictionOutcome.findMany({ where: { productId }, orderBy: { predictedAt: "desc" } });
  },

  /** Every resolved outcome (docs/M9_ARCHITECTURE_PROPOSAL.md §29's own prediction-accuracy axis) — grouping by predictionSource happens in application code, not SQL, matching this codebase's existing dev-fixture scale. */
  listResolved(): Promise<PredictionOutcome[]> {
    return prisma.predictionOutcome.findMany({ where: { observedValue: { not: null } }, orderBy: { resolvedAt: "desc" } });
  },
};

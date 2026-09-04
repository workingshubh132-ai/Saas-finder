import type { Cohort } from "@prisma/client";
import { prisma } from "../client.js";

export interface UpsertCohortInput {
  productId: string;
  dimension: string;
  dimensionValue: string;
}

/** Unique per (productId, dimension, dimensionValue) — a re-run of cohort discovery is an idempotent upsert, never a duplicate row (docs/M8_ARCHITECTURE_PROPOSAL.md §6). */
export const cohortRepository = {
  upsert(input: UpsertCohortInput): Promise<Cohort> {
    return prisma.cohort.upsert({
      where: {
        productId_dimension_dimensionValue: {
          productId: input.productId,
          dimension: input.dimension,
          dimensionValue: input.dimensionValue,
        },
      },
      create: input,
      update: {},
    });
  },

  findById(id: string): Promise<Cohort | null> {
    return prisma.cohort.findUnique({ where: { id } });
  },

  listForProduct(productId: string): Promise<Cohort[]> {
    return prisma.cohort.findMany({ where: { productId } });
  },
};

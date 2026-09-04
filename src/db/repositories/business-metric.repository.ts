import type { BusinessMetric } from "@prisma/client";
import { prisma } from "../client.js";
import { assertMetricProvenance } from "../../domain/business-metric/business-metric.types.js";

export interface CreateBusinessMetricInput {
  productId: string;
  metricType: string;
  valueKind: string;
  value: number;
  source: string;
  /** M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §9) — optional, additive; every M7 call site keeps working unchanged. */
  periodStart?: Date;
  periodEnd?: Date;
  cohortId?: string;
  inputMetricIds?: readonly string[];
}

/** Structural "observed vs. estimated" enforcement (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §23), widened to four value kinds for M8 (docs/M8_ARCHITECTURE_PROPOSAL.md §9). */
export const businessMetricRepository = {
  create(input: CreateBusinessMetricInput): Promise<BusinessMetric> {
    assertMetricProvenance({
      valueKind: input.valueKind as never,
      source: input.source as never,
      inputMetricIds: input.inputMetricIds,
    });
    return prisma.businessMetric.create({
      data: {
        productId: input.productId,
        metricType: input.metricType,
        valueKind: input.valueKind,
        value: input.value,
        source: input.source,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        cohortId: input.cohortId,
        inputMetricIds: input.inputMetricIds ? JSON.stringify(input.inputMetricIds) : undefined,
      },
    });
  },

  listForProduct(productId: string): Promise<BusinessMetric[]> {
    return prisma.businessMetric.findMany({ where: { productId }, orderBy: { recordedAt: "desc" } });
  },

  listForProductByType(productId: string, metricType: string): Promise<BusinessMetric[]> {
    return prisma.businessMetric.findMany({ where: { productId, metricType }, orderBy: { recordedAt: "desc" } });
  },

  findLatestForProductByType(productId: string, metricType: string): Promise<BusinessMetric | null> {
    return prisma.businessMetric.findFirst({ where: { productId, metricType }, orderBy: { recordedAt: "desc" } });
  },

  /**
   * Trailing values for anomaly detection's baseline (docs/M8_ARCHITECTURE_PROPOSAL.md
   * §19) — oldest first, most recent `limit` periods, excluding
   * nothing (the caller supplies the value being tested separately).
   */
  async listTrailingValuesForType(productId: string, metricType: string, limit: number): Promise<number[]> {
    const rows = await prisma.businessMetric.findMany({
      where: { productId, metricType },
      orderBy: { recordedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => r.value).reverse();
  },
};

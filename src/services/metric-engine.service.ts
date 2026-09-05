import type { Anomaly, BusinessMetric } from "@prisma/client";
import { activationDefinitionRepository } from "../db/repositories/activation-definition.repository.js";
import { anomalyRepository } from "../db/repositories/anomaly.repository.js";
import { businessMetricRepository } from "../db/repositories/business-metric.repository.js";
import { computeActivationRate } from "../domain/product-intelligence/activation.js";
import { computeRetention, type RetentionCohortMember, type RetentionResult, type RetentionWindow } from "../domain/product-intelligence/retention.js";
import {
  computeGrossRevenueRetention,
  computeLogoChurn,
  computeNetRevenueRetention,
  computeRevenueChurn,
  type SubscriptionPeriodDelta,
} from "../domain/revenue-intelligence/churn.js";
import { computeRevenueMetrics, type RevenueMetricsResult } from "../domain/revenue-intelligence/revenue-metrics.js";
import { detectAnomaly, MIN_BASELINE_PERIODS } from "../domain/anomaly/anomaly.types.js";
import { isComputed, type MetricResult } from "../domain/shared/metric-result.js";
import { createProductUsageProvider } from "../providers/product-usage-provider-factory.js";
import { createRevenueProvider } from "../providers/revenue-provider-factory.js";
import { alertService } from "./alert.service.js";
import { eventBus } from "./event-bus.js";

const TRAILING_BASELINE_PERIODS = 6;

/**
 * The deterministic metric engine (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §2, §9): reads a provider, runs a pure domain calculation, records a
 * correctly-labeled BusinessMetric row. No model call anywhere in this
 * file (§35 — deterministic-first). Every "record" here follows the
 * same rule: a COMPUTED MetricResult becomes a BusinessMetric row; an
 * UNKNOWN or INSUFFICIENT_DATA result is returned to the caller but
 * never silently written as a fabricated number.
 */
export const metricEngineService = {
  async computeAndRecordActivation(productId: string, now: Date): Promise<MetricResult> {
    const definition = await activationDefinitionRepository.findLatestForProduct(productId);
    if (!definition) {
      return { status: "INSUFFICIENT_DATA", reason: `No ActivationDefinition set for product ${productId} — activation is product-defined and must be set once before it can be measured.` };
    }

    const usage = createProductUsageProvider();
    const periodStart = new Date(0);
    const signups = await usage.listEvents({ productId, eventName: "signup", periodStart, periodEnd: now });
    const activations = await usage.listEvents({ productId, eventName: definition.eventName, periodStart, periodEnd: now });
    const activatedUsers = new Set(activations.map((e) => e.userRef));

    const result = computeActivationRate({ signupCount: signups.length, activatedCount: activatedUsers.size });
    if (isComputed(result)) {
      await businessMetricRepository.create({ productId, metricType: "ACTIVATION_RATE", valueKind: "OBSERVED", value: result.value, source: "PRODUCT_USAGE_PROVIDER" });
    }
    return result;
  },

  async computeAndRecordRetention(productId: string, window: RetentionWindow, now: Date): Promise<RetentionResult> {
    const usage = createProductUsageProvider();
    const periodStart = new Date(0);
    const signups = await usage.listEvents({ productId, eventName: "signup", periodStart, periodEnd: now });
    const activity = await usage.listEvents({ productId, periodStart, periodEnd: now });

    const lastActiveByUser = new Map<string, Date>();
    for (const e of activity) {
      if (e.name === "signup") continue;
      const prior = lastActiveByUser.get(e.userRef);
      if (!prior || e.occurredAt > prior) lastActiveByUser.set(e.userRef, e.occurredAt);
    }

    const members: RetentionCohortMember[] = signups.map((s) => ({
      signedUpAt: s.occurredAt,
      lastActiveAt: lastActiveByUser.get(s.userRef) ?? null,
    }));

    const result = computeRetention(window, members, now);
    if (result.status === "COMPUTED") {
      await businessMetricRepository.create({
        productId,
        metricType: `RETENTION_${window}`,
        valueKind: "OBSERVED",
        value: result.retentionRate,
        source: "PRODUCT_USAGE_PROVIDER",
      });
    }
    return result;
  },

  async computeAndRecordRevenueMetrics(productId: string, asOf: Date): Promise<RevenueMetricsResult> {
    const revenue = createRevenueProvider();
    const subscriptions = await revenue.listSubscriptionsAsOf(productId, asOf);
    const result = computeRevenueMetrics({
      activeSubscriptions: subscriptions.map((s) => ({ id: s.id, monthlyValueUsd: s.monthlyValueUsd })),
      newMrr: 0,
      expansionMrr: 0,
      contractionMrr: 0,
      churnedMrr: 0,
      refundsUsd: 0,
    });

    let mrrMetricId: string | null = null;
    if (isComputed(result.mrr)) {
      const mrrMetric = await businessMetricRepository.create({ productId, metricType: "MRR", valueKind: "OBSERVED", value: result.mrr.value, source: "REVENUE_PROVIDER" });
      mrrMetricId = mrrMetric.id;
      // docs/M9_ARCHITECTURE_PROPOSAL.md §42 — no event fired when an OBSERVED MRR row was recorded before this fix.
      await eventBus.publish({ type: "REVENUE_OBSERVED", payload: { productId, metricId: mrrMetric.id, value: result.mrr.value } });
    }
    // ARR and ARPU are both deterministically derived from the MRR row just recorded — INFERRED requires
    // a real inputMetricIds citation (assertMetricProvenance), so both are gated on that row actually existing.
    if (isComputed(result.arr) && mrrMetricId) {
      await businessMetricRepository.create({ productId, metricType: "ARR", valueKind: "INFERRED", value: result.arr.value, source: "DETERMINISTIC_CALCULATION", inputMetricIds: [mrrMetricId] });
    }
    if (isComputed(result.arpu) && mrrMetricId) {
      await businessMetricRepository.create({ productId, metricType: "ARPU", valueKind: "INFERRED", value: result.arpu.value, source: "DETERMINISTIC_CALCULATION", inputMetricIds: [mrrMetricId] });
    }
    return result;
  },

  /**
   * Contraction/expansion tracking requires per-subscription plan-change
   * history the dev-fixture RevenueProvider doesn't model (a real
   * limitation, documented rather than fabricated —
   * docs/M8_ARCHITECTURE_PROPOSAL.md's own §45 "known limitations");
   * both are always 0 here, never an invented number.
   */
  async computeAndRecordChurn(
    productId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ logoChurn: MetricResult; revenueChurn: MetricResult; grossRevenueRetention: MetricResult; netRevenueRetention: MetricResult }> {
    const revenue = createRevenueProvider();
    const startSubs = await revenue.listSubscriptionsAsOf(productId, periodStart);
    const endSubs = await revenue.listSubscriptionsAsOf(productId, periodEnd);
    const endIds = new Set(endSubs.map((s) => s.id));
    const churned = startSubs.filter((s) => !endIds.has(s.id));

    const delta: SubscriptionPeriodDelta = {
      startingActiveCount: startSubs.length,
      startingMrr: startSubs.reduce((sum, s) => sum + s.monthlyValueUsd, 0),
      cancelledCount: churned.length,
      churnedMrr: churned.reduce((sum, s) => sum + s.monthlyValueUsd, 0),
      contractedMrr: 0,
      expansionMrr: 0,
    };

    const logoChurn = computeLogoChurn(delta);
    const revenueChurn = computeRevenueChurn(delta);
    const grossRevenueRetention = computeGrossRevenueRetention(delta);
    const netRevenueRetention = computeNetRevenueRetention(delta);

    const recordings: Array<[string, MetricResult]> = [
      ["LOGO_CHURN_RATE", logoChurn],
      ["REVENUE_CHURN_RATE", revenueChurn],
      ["GROSS_REVENUE_RETENTION", grossRevenueRetention],
      ["NET_REVENUE_RETENTION", netRevenueRetention],
    ];
    for (const [metricType, result] of recordings) {
      if (isComputed(result)) {
        await businessMetricRepository.create({
          productId,
          metricType,
          valueKind: "OBSERVED",
          value: result.value,
          source: "REVENUE_PROVIDER",
          periodStart,
          periodEnd,
        });
      }
    }

    return { logoChurn, revenueChurn, grossRevenueRetention, netRevenueRetention };
  },

  /**
   * Deterministic anomaly detection over this product's own recent
   * BusinessMetric history for one metric type (docs/M8_ARCHITECTURE_PROPOSAL.md
   * §19) — creates an Anomaly row only when the z-score threshold is
   * actually crossed; returns null (not an empty Anomaly) otherwise.
   */
  async detectAnomaliesForMetric(productId: string, metricType: string, latestValue: number): Promise<Anomaly | null> {
    const trailing = await businessMetricRepository.listTrailingValuesForType(productId, metricType, TRAILING_BASELINE_PERIODS);
    if (trailing.length < MIN_BASELINE_PERIODS) return null;

    const detection = detectAnomaly({ trailingValues: trailing, latestValue });
    if (!detection.isAnomaly || detection.direction === null || detection.zScore === null || detection.baselineMean === null || detection.baselineStdDev === null) {
      return null;
    }

    const anomaly = await anomalyRepository.create({
      productId,
      metricType,
      direction: detection.direction,
      observedValue: latestValue,
      baselineMean: detection.baselineMean,
      baselineStdDev: detection.baselineStdDev,
      zScore: detection.zScore,
      reason: detection.reason,
    });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §8, §42 — no M8 event fired here before this fix.
    await eventBus.publish({ type: "ANOMALY_DETECTED", payload: { anomalyId: anomaly.id, productId, metricType, direction: anomaly.direction, zScore: anomaly.zScore } });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §35-36 — a real, already-detected anomaly is alert-worthy by construction (detectAnomaly only returns isAnomaly=true past its own threshold); never a second detector.
    await alertService.raise({
      alertType: "ANOMALY",
      severity: Math.abs(anomaly.zScore) >= 4 ? "CRITICAL" : "WARNING",
      resourceType: "PRODUCT",
      resourceId: productId,
      message: `${metricType} ${anomaly.direction === "UP" ? "spiked" : "dropped"} (z-score ${anomaly.zScore.toFixed(2)}): ${anomaly.reason}`,
    });
    return anomaly;
  },

  listForProduct(productId: string): Promise<BusinessMetric[]> {
    return businessMetricRepository.listForProduct(productId);
  },
};

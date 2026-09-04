import { randomUUID } from "node:crypto";
import type {
  CancelSubscriptionRecordInput,
  RecordRefundInput,
  RecordSubscriptionInput,
  RefundRecord,
  RevenueProvider,
  SubscriptionRecord,
} from "../domain/ports/revenue-provider.js";

interface FixtureSubscription {
  id: string;
  productId: string;
  monthlyValueUsd: number;
  status: "ACTIVE" | "CANCELLED";
  startedAt: Date;
  cancelledAt: Date | null;
}

/**
 * DEV_FIXTURE only (docs/M8_ARCHITECTURE_PROPOSAL.md §16, §31) —
 * in-memory, fed explicitly by whatever created the subscription
 * (mirroring DevBillingProvider's own referential-integrity
 * discipline — a real record of a real fixture event, never a static
 * stub).
 */
export class DevRevenueProvider implements RevenueProvider {
  readonly id = "DEV_FIXTURE";
  private readonly subscriptions = new Map<string, FixtureSubscription>();
  private readonly refunds: RefundRecord[] = [];

  async recordSubscription(input: RecordSubscriptionInput): Promise<void> {
    this.subscriptions.set(input.id, {
      id: input.id,
      productId: input.productId,
      monthlyValueUsd: input.monthlyValueUsd,
      status: "ACTIVE",
      startedAt: input.startedAt,
      cancelledAt: null,
    });
  }

  async cancelSubscription(input: CancelSubscriptionRecordInput): Promise<void> {
    const sub = this.subscriptions.get(input.id);
    if (!sub) {
      throw new Error(`[DEV_FIXTURE] cancelSubscription: unknown subscription id "${input.id}".`);
    }
    sub.status = "CANCELLED";
    sub.cancelledAt = input.cancelledAt;
  }

  async recordRefund(input: RecordRefundInput): Promise<RefundRecord> {
    const refund: RefundRecord = { id: `dev-refund-${randomUUID()}`, ...input };
    this.refunds.push(refund);
    return refund;
  }

  async listSubscriptionsAsOf(productId: string, asOf: Date): Promise<readonly SubscriptionRecord[]> {
    return [...this.subscriptions.values()].filter(
      (s) => s.productId === productId && s.startedAt <= asOf && (s.cancelledAt === null || s.cancelledAt > asOf),
    );
  }

  async listRefunds(productId: string, periodStart: Date, periodEnd: Date): Promise<readonly RefundRecord[]> {
    return this.refunds.filter((r) => r.productId === productId && r.refundedAt >= periodStart && r.refundedAt <= periodEnd);
  }
}

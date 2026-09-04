/**
 * Seam for revenue-intelligence's subscription/refund data
 * (docs/M8_ARCHITECTURE_PROPOSAL.md §16, §31). Only DevRevenueProvider
 * exists in M8 — dev-fixture, zero network, fed explicitly by whatever
 * created the subscription (mirroring DevBillingProvider's own
 * referential-integrity discipline: a real record of a real fixture
 * event, never a static stub).
 */
export interface SubscriptionRecord {
  readonly id: string;
  readonly productId: string;
  readonly monthlyValueUsd: number;
  readonly status: "ACTIVE" | "CANCELLED";
  readonly startedAt: Date;
  readonly cancelledAt: Date | null;
}

export interface RecordSubscriptionInput {
  readonly id: string;
  readonly productId: string;
  readonly monthlyValueUsd: number;
  readonly startedAt: Date;
}

export interface CancelSubscriptionRecordInput {
  readonly id: string;
  readonly cancelledAt: Date;
}

export interface RefundRecord {
  readonly id: string;
  readonly productId: string;
  readonly amountUsd: number;
  readonly refundedAt: Date;
}

export interface RecordRefundInput {
  readonly productId: string;
  readonly amountUsd: number;
  readonly refundedAt: Date;
}

export interface RevenueProvider {
  readonly id: string;
  recordSubscription(input: RecordSubscriptionInput): Promise<void>;
  cancelSubscription(input: CancelSubscriptionRecordInput): Promise<void>;
  recordRefund(input: RecordRefundInput): Promise<RefundRecord>;
  /** Every subscription for a product whose status, as of `asOf`, was ACTIVE. */
  listSubscriptionsAsOf(productId: string, asOf: Date): Promise<readonly SubscriptionRecord[]>;
  listRefunds(productId: string, periodStart: Date, periodEnd: Date): Promise<readonly RefundRecord[]>;
}

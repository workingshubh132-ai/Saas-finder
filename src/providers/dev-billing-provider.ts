import { randomUUID } from "node:crypto";
import type {
  BillingProvider,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  CreateBillingCustomerInput,
  CreateBillingCustomerResult,
  CreateBillingPriceInput,
  CreateBillingPriceResult,
  CreateBillingProductInput,
  CreateBillingProductResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  SubscriptionStatusResult,
} from "../domain/ports/billing-provider.js";

interface FixtureProduct {
  name: string;
  description: string;
}
interface FixturePrice {
  providerProductRef: string;
  amountUsdCents: number;
  interval: "MONTH" | "YEAR";
}
interface FixtureCustomer {
  email: string;
}
interface FixtureSubscription {
  providerCustomerRef: string;
  providerPriceRef: string;
  status: string;
}

/**
 * DEV_FIXTURE only (docs/M7_ARCHITECTURE_PROPOSAL.md §7, §9) —
 * in-memory, zero network calls, moves no real money. Maintains real
 * referential integrity between its own fixture rows (createSubscription
 * refuses a customer/price ref this same instance never created) —
 * the "derived from real input, never a static stub" discipline every
 * other dev fixture in this codebase already follows.
 */
export class DevBillingProvider implements BillingProvider {
  readonly id = "DEV_FIXTURE";
  private readonly products = new Map<string, FixtureProduct>();
  private readonly prices = new Map<string, FixturePrice>();
  private readonly customers = new Map<string, FixtureCustomer>();
  private readonly subscriptions = new Map<string, FixtureSubscription>();

  async createProduct(input: CreateBillingProductInput): Promise<CreateBillingProductResult> {
    const providerProductRef = `dev-prod-${randomUUID()}`;
    this.products.set(providerProductRef, { name: input.name, description: input.description });
    return { providerProductRef };
  }

  async createPrice(input: CreateBillingPriceInput): Promise<CreateBillingPriceResult> {
    if (!this.products.has(input.providerProductRef)) {
      throw new Error(`[DEV_FIXTURE] createPrice: unknown providerProductRef "${input.providerProductRef}".`);
    }
    const providerPriceRef = `dev-price-${randomUUID()}`;
    this.prices.set(providerPriceRef, { providerProductRef: input.providerProductRef, amountUsdCents: input.amountUsdCents, interval: input.interval });
    return { providerPriceRef };
  }

  async createCustomer(input: CreateBillingCustomerInput): Promise<CreateBillingCustomerResult> {
    const providerCustomerRef = `dev-cust-${randomUUID()}`;
    this.customers.set(providerCustomerRef, { email: input.email });
    return { providerCustomerRef };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    if (!this.customers.has(input.providerCustomerRef) || !this.prices.has(input.providerPriceRef)) {
      throw new Error("[DEV_FIXTURE] createSubscription requires a real, already-created customer and price.");
    }
    const providerSubscriptionRef = `dev-sub-${randomUUID()}`;
    this.subscriptions.set(providerSubscriptionRef, { providerCustomerRef: input.providerCustomerRef, providerPriceRef: input.providerPriceRef, status: "ACTIVE" });
    return { providerSubscriptionRef, status: "ACTIVE" };
  }

  async cancelSubscription(input: CancelSubscriptionInput): Promise<CancelSubscriptionResult> {
    const sub = this.subscriptions.get(input.providerSubscriptionRef);
    if (sub) sub.status = "CANCELLED";
    return { status: "CANCELLED" };
  }

  async status(providerSubscriptionRef: string): Promise<SubscriptionStatusResult> {
    return { status: this.subscriptions.get(providerSubscriptionRef)?.status ?? "UNKNOWN" };
  }
}

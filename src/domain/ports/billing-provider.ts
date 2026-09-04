/**
 * Seam for M7's ACTIVATE_BILLING EXECUTE step to call a real payment
 * platform without the kernel depending on a specific vendor
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §7, §9). Only DevBillingProvider
 * exists in M7; a real implementation is additive later, never a
 * change to this contract or to any calling code.
 */
export interface CreateBillingProductInput {
  readonly name: string;
  readonly description: string;
}

export interface CreateBillingProductResult {
  readonly providerProductRef: string;
}

export interface CreateBillingPriceInput {
  readonly providerProductRef: string;
  readonly amountUsdCents: number;
  readonly interval: "MONTH" | "YEAR";
}

export interface CreateBillingPriceResult {
  readonly providerPriceRef: string;
}

export interface CreateBillingCustomerInput {
  readonly email: string;
}

export interface CreateBillingCustomerResult {
  readonly providerCustomerRef: string;
}

export interface CreateSubscriptionInput {
  readonly providerCustomerRef: string;
  readonly providerPriceRef: string;
}

export interface CreateSubscriptionResult {
  readonly providerSubscriptionRef: string;
  readonly status: "ACTIVE";
}

export interface CancelSubscriptionInput {
  readonly providerSubscriptionRef: string;
}

export interface CancelSubscriptionResult {
  readonly status: "CANCELLED";
}

export interface SubscriptionStatusResult {
  readonly status: string;
}

export interface BillingProvider {
  readonly id: string;
  createProduct(input: CreateBillingProductInput): Promise<CreateBillingProductResult>;
  createPrice(input: CreateBillingPriceInput): Promise<CreateBillingPriceResult>;
  createCustomer(input: CreateBillingCustomerInput): Promise<CreateBillingCustomerResult>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<CancelSubscriptionResult>;
  status(providerSubscriptionRef: string): Promise<SubscriptionStatusResult>;
}

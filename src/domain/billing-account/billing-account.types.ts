/**
 * Created only by the ACTIVATE_BILLING EXECUTE step
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §19) — the real (fixture-scoped)
 * counterpart to an ACTIVE BillingPlan. A subscription fixture created
 * against it (the billing capstone, §40.4) is a separate, explicit
 * act, never implied by ACTIVE alone.
 */
export const BILLING_ACCOUNT_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export type BillingAccountStatus = (typeof BILLING_ACCOUNT_STATUSES)[number];

export function isBillingAccountStatus(value: string): value is BillingAccountStatus {
  return (BILLING_ACCOUNT_STATUSES as readonly string[]).includes(value);
}

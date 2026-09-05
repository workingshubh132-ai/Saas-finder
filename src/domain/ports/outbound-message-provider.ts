/**
 * Seam for the real send step Autonomous Operations Phase A adds
 * (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) — mirrors `DeploymentProvider`/
 * `BillingProvider`'s own contract exactly. Deliberately narrow: a
 * provider only knows how to send one exact piece of already-approved
 * content to one exact, already-known destination and report what
 * happened. It holds no policy of its own — rate limiting, budget,
 * approval-freshness re-verification, and idempotency all live in
 * `outboundMessageService`, the same division of labor
 * `deploymentService`/`billingActivationService` already established
 * for their own providers.
 *
 * Explicitly NOT a generic HTTP sender: no arbitrary URL, no
 * caller-chosen transport. `destination` is always
 * `Prospect.publicContactChannel` (already the public, dereferenceable
 * source every M5 prospect carries — never a private contact method),
 * and only `outboundMessageService` may construct one of these calls,
 * never an agent directly.
 */
export interface SendMessageInput {
  readonly destination: string;
  readonly content: string;
  /** Caller-supplied, stable across retries — a provider must treat two calls with the same key as one logical send. */
  readonly idempotencyKey: string;
}

export interface SendMessageResult {
  readonly status: "SENT" | "FAILED";
  readonly providerRef: string;
  readonly detail: string;
}

export interface DeliveryStatusResult {
  readonly status: "SENT" | "DELIVERED" | "FAILED" | "UNKNOWN";
}

export interface OutboundMessageProvider {
  readonly id: string;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  getDeliveryStatus(providerRef: string): Promise<DeliveryStatusResult>;
}

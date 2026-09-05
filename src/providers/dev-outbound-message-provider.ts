import type { DeliveryStatusResult, OutboundMessageProvider, SendMessageInput, SendMessageResult } from "../domain/ports/outbound-message-provider.js";

interface FixtureSend {
  destination: string;
  content: string;
  status: "SENT" | "FAILED";
}

/**
 * DEV_FIXTURE only (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) — in-memory,
 * zero network calls, can never reach anything real. Keyed by
 * idempotencyKey so a second call with the same key returns the
 * original result rather than sending twice — the provider's own
 * last-resort idempotency floor, underneath `outboundMessageService`'s
 * own (the real, load-bearing one).
 */
export class DevOutboundMessageProvider implements OutboundMessageProvider {
  readonly id = "DEV_FIXTURE";
  private readonly sends = new Map<string, FixtureSend>();

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const existing = this.sends.get(input.idempotencyKey);
    if (existing) {
      const providerRef = `dev-send-${input.idempotencyKey}`;
      return { status: existing.status, providerRef, detail: `[DEV_FIXTURE] Idempotent replay — already sent as ${providerRef}.` };
    }
    if (!input.destination.trim() || !input.content.trim()) {
      this.sends.set(input.idempotencyKey, { destination: input.destination, content: input.content, status: "FAILED" });
      return { status: "FAILED", providerRef: "", detail: "[DEV_FIXTURE] Empty destination or content." };
    }
    const providerRef = `dev-send-${input.idempotencyKey}`;
    this.sends.set(input.idempotencyKey, { destination: input.destination, content: input.content, status: "SENT" });
    return { status: "SENT", providerRef, detail: `[DEV_FIXTURE] Sent to "${input.destination}". No real message was transmitted — this container has no reachable outbound provider (docs/M10_REAL_WORLD_AUDIT.md).` };
  }

  async getDeliveryStatus(providerRef: string): Promise<DeliveryStatusResult> {
    const key = providerRef.replace(/^dev-send-/, "");
    const record = this.sends.get(key);
    if (!record) return { status: "UNKNOWN" };
    return { status: record.status === "SENT" ? "DELIVERED" : "FAILED" };
  }
}

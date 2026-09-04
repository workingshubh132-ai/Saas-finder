import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature/replay verification (docs/M7_ARCHITECTURE_PROPOSAL.md
 * §20) — built to the standard a real provider integration would need,
 * even though its only caller in M7 is the dev-fixture provider/test
 * harness (§7). "Never trust a webhook merely because it reaches the
 * endpoint."
 */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function signWebhookPayload(secret: string, rawBody: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export interface VerifyWebhookSignatureInput {
  secret: string;
  rawBody: string;
  timestamp: number;
  signature: string;
  now?: number;
}

export interface VerifyWebhookSignatureResult {
  valid: boolean;
  reason: string;
}

/**
 * Constant-time signature comparison + a bounded replay window. A
 * malformed hex signature (wrong length, non-hex characters) is an
 * invalid signature, never a thrown exception — this function is
 * called directly against untrusted request bodies.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): VerifyWebhookSignatureResult {
  const now = input.now ?? Date.now();
  if (Math.abs(now - input.timestamp) > REPLAY_WINDOW_MS) {
    return { valid: false, reason: `Timestamp ${input.timestamp} is outside the ${REPLAY_WINDOW_MS / 1000}s replay window (now=${now}).` };
  }

  const expected = signWebhookPayload(input.secret, input.rawBody, input.timestamp);
  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    actualBuf = Buffer.from(input.signature, "hex");
  } catch {
    return { valid: false, reason: "Signature is not valid hex." };
  }
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: "Signature does not match the expected HMAC for this payload and timestamp." };
  }

  return { valid: true, reason: "Signature valid." };
}

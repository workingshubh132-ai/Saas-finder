import type { OutboundMessageProvider } from "../domain/ports/outbound-message-provider.js";
import { DevOutboundMessageProvider } from "./dev-outbound-message-provider.js";

/** Mirrors deployment-provider-factory.ts. Only DevOutboundMessageProvider exists — see docs/AUTONOMOUS_OPERATIONS_AUDIT.md and docs/M10_REAL_WORLD_AUDIT.md for why a real one isn't built in this environment. */
const instance = new DevOutboundMessageProvider();

export function createOutboundMessageProvider(): OutboundMessageProvider {
  return instance;
}

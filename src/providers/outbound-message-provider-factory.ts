import { config, type OutboundMessageProviderMode } from "../config.js";
import type { OutboundMessageProvider } from "../domain/ports/outbound-message-provider.js";
import { ProviderNotConfiguredError } from "../domain/shared/errors.js";
import { DevOutboundMessageProvider } from "./dev-outbound-message-provider.js";

/**
 * The one place that decides which OutboundMessageProvider
 * implementation the runtime talks to — mirrors createModelProvider()'s
 * own seam (docs/M2_ARCHITECTURE_PROPOSAL.md §9), extended with an
 * explicit runtime mode (Autonomous Operations Phase A hardening,
 * docs/AUTONOMOUS_OPERATIONS_AUDIT.md, docs/PHASE_A_CAPSTONE.md).
 *
 * Unlike ModelProvider, no real implementation exists yet: "REAL" is a
 * real, distinct mode a future real provider will satisfy — never a
 * synonym for "try REAL, fall back to DEV_FIXTURE if unavailable." When
 * "REAL" is configured, this throws ProviderNotConfiguredError instead
 * of ever returning DevOutboundMessageProvider — a fixture must never
 * be silently mistaken for a real outbound channel.
 */
const devInstance = new DevOutboundMessageProvider();

export function createOutboundMessageProvider(): OutboundMessageProvider {
  if (config.outboundMessageProviderMode === "REAL") {
    throw new ProviderNotConfiguredError("OutboundMessageProvider");
  }
  return devInstance;
}

/** Inspectable mode for logs/tests (brief item 10) — reflects config only; never itself bypasses createOutboundMessageProvider()'s own fail-closed check above. */
export function getOutboundMessageProviderMode(): OutboundMessageProviderMode {
  return config.outboundMessageProviderMode;
}

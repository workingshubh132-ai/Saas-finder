import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Autonomous Operations Phase A hardening — an explicit runtime
 * provider mode so DEV_FIXTURE can never be silently mistaken for a
 * real outbound channel (docs/PHASE_A_CAPSTONE.md). config.ts snapshots
 * process.env at module-load time (same as MODEL_PROVIDER_MODE/
 * RESEARCH_TOOL_MODE), so exercising more than one mode value in this
 * file requires vi.resetModules() + a fresh dynamic import per test —
 * the same env-then-dynamic-import ordering tests/setup.ts's own
 * top-of-file comment already documents, just per-test instead of
 * once per suite.
 */
const ORIGINAL_MODE = process.env.OUTBOUND_MESSAGE_PROVIDER_MODE;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_MODE === undefined) delete process.env.OUTBOUND_MESSAGE_PROVIDER_MODE;
  else process.env.OUTBOUND_MESSAGE_PROVIDER_MODE = ORIGINAL_MODE;
});

async function freshFactory() {
  return import("../../src/providers/outbound-message-provider-factory.js");
}

describe("outbound message provider mode", () => {
  it("A. defaults to DEV_FIXTURE when OUTBOUND_MESSAGE_PROVIDER_MODE is unset", async () => {
    delete process.env.OUTBOUND_MESSAGE_PROVIDER_MODE;
    const { createOutboundMessageProvider, getOutboundMessageProviderMode } = await freshFactory();

    expect(getOutboundMessageProviderMode()).toBe("DEV_FIXTURE");
    const provider = createOutboundMessageProvider();
    expect(provider.id).toBe("DEV_FIXTURE");
  });

  it("B. explicit DEV_FIXTURE returns DevOutboundMessageProvider", async () => {
    process.env.OUTBOUND_MESSAGE_PROVIDER_MODE = "DEV_FIXTURE";
    const { createOutboundMessageProvider, getOutboundMessageProviderMode } = await freshFactory();
    const { DevOutboundMessageProvider } = await import("../../src/providers/dev-outbound-message-provider.js");

    expect(getOutboundMessageProviderMode()).toBe("DEV_FIXTURE");
    const provider = createOutboundMessageProvider();
    expect(provider).toBeInstanceOf(DevOutboundMessageProvider);
    expect(provider.id).toBe("DEV_FIXTURE");
  });

  it("C. explicit REAL with no real provider configured fails closed with a typed domain error", async () => {
    process.env.OUTBOUND_MESSAGE_PROVIDER_MODE = "REAL";
    const { createOutboundMessageProvider, getOutboundMessageProviderMode } = await freshFactory();
    const { ProviderNotConfiguredError } = await import("../../src/domain/shared/errors.js");

    expect(getOutboundMessageProviderMode()).toBe("REAL");
    expect(() => createOutboundMessageProvider()).toThrow(ProviderNotConfiguredError);
    expect(() => createOutboundMessageProvider()).toThrow(/REAL mode.*no real provider implementation/i);
  });

  it("D. REAL mode never silently instantiates DevOutboundMessageProvider — no fallback, deterministically, across repeated calls", async () => {
    process.env.OUTBOUND_MESSAGE_PROVIDER_MODE = "REAL";
    const { createOutboundMessageProvider, getOutboundMessageProviderMode } = await freshFactory();

    let providerReturned: unknown;
    try {
      providerReturned = createOutboundMessageProvider();
    } catch {
      providerReturned = undefined;
    }
    expect(providerReturned).toBeUndefined();

    // Repeated calls throw every time — never a fixture returned on a later attempt, and the mode itself is never coerced back to DEV_FIXTURE as a side effect of the failed attempt.
    for (let i = 0; i < 3; i += 1) {
      expect(() => createOutboundMessageProvider()).toThrow();
    }
    expect(getOutboundMessageProviderMode()).toBe("REAL");
  });
});

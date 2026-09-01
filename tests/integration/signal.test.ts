import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/domain/shared/errors.js";
import { signalService } from "../../src/services/signal.service.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { makeAgent } from "../helpers.js";

function raw(overrides: Partial<RawSourceResult> = {}): RawSourceResult {
  return {
    title: "Invoicing small businesses is a nightmare",
    content: "Every month I spend six hours reconciling invoices across three different tools.",
    url: "https://example.com/thread/1",
    publishedAt: "2026-08-20T00:00:00Z",
    authorContext: "user123",
    sourceGroupKey: null,
    metadata: { points: 42 },
    ...overrides,
  };
}

describe("signalService.ingest", () => {
  it("normalizes a raw result into a PROCESSED signal with a seeded reliability and computed quality score", async () => {
    const agent = await makeAgent();
    const signal = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });

    expect(signal.status).toBe("PROCESSED");
    expect(signal.collectedByAgentId).toBe(agent.id);
    expect(signal.reliability).toBe("MEDIUM"); // hacker_news's seeded baseline
    expect(signal.qualityScore).toBeGreaterThan(0);
    expect(signal.sourceReference).toBe("https://example.com/thread/1");
  });

  it("marks an exact content duplicate as DUPLICATE, with an explainable reason and a link to the original", async () => {
    const agent = await makeAgent();
    const first = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const second = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ url: "https://example.com/thread/1-mirror" }), // different URL, identical title+content
      collectedByAgentId: agent.id,
    });

    expect(second.status).toBe("DUPLICATE");
    expect(second.duplicateOfSignalId).toBe(first.id);
    expect(second.duplicateReason).toMatch(/identical content hash/);
  });

  it("marks a repost of the same source reference as DUPLICATE even with slightly different text", async () => {
    const agent = await makeAgent();
    const first = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const second = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ content: "Every month I spend six hours reconciling invoices across three different tools now." }), // same URL, edited text
      collectedByAgentId: agent.id,
    });

    expect(second.status).toBe("DUPLICATE");
    expect(second.duplicateOfSignalId).toBe(first.id);
    expect(second.duplicateReason).toMatch(/same source reference/);
  });

  it("marks near-identical content from a different source reference as a near-duplicate", async () => {
    const agent = await makeAgent();
    const first = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const second = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({
        url: "https://example.com/thread/2",
        content: "Every month I spend six hours reconciling invoices across three different tools!", // near-identical, different punctuation
      }),
      collectedByAgentId: agent.id,
    });

    expect(second.status).toBe("DUPLICATE");
    expect(second.duplicateOfSignalId).toBe(first.id);
    expect(second.duplicateReason).toMatch(/near-duplicate content/);
  });

  it("never inflates a duplicate's quality score", async () => {
    const agent = await makeAgent();
    await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const duplicate = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ url: "https://example.com/thread/1-mirror" }),
      collectedByAgentId: agent.id,
    });
    expect(duplicate.qualityScore).toBe(0);
  });

  it("rejects unusable (empty) content rather than silently dropping it", async () => {
    const agent = await makeAgent();
    const signal = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ title: "  ", content: "  " }),
      collectedByAgentId: agent.id,
    });
    expect(signal.status).toBe("REJECTED");
  });

  it("rejects an unknown source type", async () => {
    const agent = await makeAgent();
    await expect(
      signalService.ingest({ source: "hacker_news", sourceType: "NOT_A_REAL_TYPE", raw: raw(), collectedByAgentId: agent.id }),
    ).rejects.toThrow(ValidationError);
  });

  it("falls back to LOW reliability for an unrecognized source id — never assumes trust it hasn't earned", async () => {
    const agent = await makeAgent();
    const signal = await signalService.ingest({ source: "some_new_unlisted_source", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    expect(signal.reliability).toBe("LOW");
  });
});

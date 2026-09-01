import { describe, expect, it } from "vitest";
import { signalClusteringService } from "../../src/services/signal-clustering.service.js";
import { signalService } from "../../src/services/signal.service.js";
import { ValidationError } from "../../src/domain/shared/errors.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { makeAgent } from "../helpers.js";

function raw(overrides: Partial<RawSourceResult> = {}): RawSourceResult {
  return {
    title: "Invoicing small businesses is a nightmare",
    content: "Every month I spend six hours reconciling invoices across three different tools.",
    url: `https://example.com/${Math.random()}`,
    publishedAt: "2026-08-20T00:00:00Z",
    authorContext: "user123",
    sourceGroupKey: null,
    metadata: {},
    ...overrides,
  };
}

describe("signalClusteringService.assign", () => {
  it("groups related signals into the same cluster and tracks independent source count", async () => {
    const agent = await makeAgent();
    const first = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const second = await signalService.ingest({
      source: "stack_exchange",
      sourceType: "WEB",
      raw: raw({ content: "I spend hours every month reconciling invoices across three different invoicing tools." }),
      collectedByAgentId: agent.id,
    });

    const clusterA = await signalClusteringService.assign(first.id);
    const clusterB = await signalClusteringService.assign(second.id);

    expect(clusterB.id).toBe(clusterA.id);
    expect(clusterB.signalCount).toBe(2);
    expect(clusterB.independentSourceCount).toBe(2);
    expect(clusterB.confidence).toBeGreaterThan(0);
  });

  it("puts unrelated signals into different clusters", async () => {
    const agent = await makeAgent();
    const invoicing = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(), collectedByAgentId: agent.id });
    const scheduling = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ title: "Staff scheduling for restaurants", content: "Our restaurant manager spends all Sunday juggling shift swaps in a spreadsheet." }),
      collectedByAgentId: agent.id,
    });

    const clusterA = await signalClusteringService.assign(invoicing.id);
    const clusterB = await signalClusteringService.assign(scheduling.id);

    expect(clusterB.id).not.toBe(clusterA.id);
  });

  it("refuses to cluster a signal that isn't PROCESSED (e.g. a duplicate)", async () => {
    const agent = await makeAgent();
    await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw({ url: "https://example.com/dup" }), collectedByAgentId: agent.id });
    const duplicate = await signalService.ingest({
      source: "hacker_news",
      sourceType: "WEB",
      raw: raw({ url: "https://example.com/dup" }),
      collectedByAgentId: agent.id,
    });
    expect(duplicate.status).toBe("DUPLICATE");
    await expect(signalClusteringService.assign(duplicate.id)).rejects.toThrow(ValidationError);
  });
});

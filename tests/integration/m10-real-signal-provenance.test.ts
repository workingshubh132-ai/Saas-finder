import { describe, expect, it } from "vitest";
import { OperatorWebSearchSource } from "../../src/sources/operator-web-search.source.js";
import { buildRealWorldTag, parseRealWorldTag } from "../../src/domain/real-world/reality.types.js";
import { signalService } from "../../src/services/signal.service.js";
import { makeAgent } from "../helpers.js";

describe("OperatorWebSearchSource (docs/M10_REAL_WORLD_AUDIT.md, docs/M10_REAL_WORLD_BOUNDARY.md)", () => {
  const pool = [
    { title: "Real thread A", content: "Real thread A", url: "https://example.com/a", publishedAt: null, authorContext: null, sourceGroupKey: null, metadata: {} },
    { title: "Real thread B", content: "Real thread B", url: "https://example.com/b", publishedAt: null, authorContext: null, sourceGroupKey: null, metadata: {} },
    { title: "Real thread C", content: "Real thread C", url: "https://example.com/c", publishedAt: null, authorContext: null, sourceGroupKey: null, metadata: {} },
  ];

  it("serves its pool in order, cursoring forward across successive calls rather than repeating results", async () => {
    const tag = buildRealWorldTag({ reality: "REAL", experimentId: "exp_1", note: "test pool" });
    const source = new OperatorWebSearchSource(pool, { id: "operator_web_search", name: "Operator Web Search (real)", tag });

    const first = await source.search("ignored query text", { maxResults: 2 });
    expect(first.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/b"]);

    const second = await source.search("a different ignored query", { maxResults: 2 });
    expect(second.map((r) => r.url)).toEqual(["https://example.com/c"]); // pool exhausted after 1 more
  });

  it("embeds the RealWorldTag into every result's metadata, readable back via parseRealWorldTag", async () => {
    const tag = buildRealWorldTag({ reality: "REAL", experimentId: "exp_42", note: "sourced via WebSearch" });
    const source = new OperatorWebSearchSource(pool, { id: "operator_web_search", name: "Operator Web Search (real)", tag });

    const [result] = await source.search("q", { maxResults: 1 });
    expect(parseRealWorldTag(result!.metadata)).toEqual(tag);
  });

  it("a tagged result survives signalService.ingest() unmodified — the real M3 ingestion path needs no M10-specific change", async () => {
    const agent = await makeAgent();
    const tag = buildRealWorldTag({ reality: "REAL", experimentId: "exp_1", note: "sourced via WebSearch" });
    const source = new OperatorWebSearchSource(pool, { id: "operator_web_search", name: "Operator Web Search (real)", tag });
    const [raw] = await source.search("q", { maxResults: 1 });

    const signal = await signalService.ingest({ source: "operator_web_search", sourceType: "WEB", raw: raw!, collectedByAgentId: agent.id });

    expect(signal.sourceReference).toBe("https://example.com/a");
    expect(signal.reliability).toBe("LOW"); // seeded baseline for operator_web_search — thinner/less verifiable than a direct API fetch
    const storedMetadata = signal.metadata ? (JSON.parse(signal.metadata) as unknown) : null;
    expect(parseRealWorldTag(storedMetadata)).toEqual(tag);
  });
});

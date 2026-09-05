import { describe, expect, it } from "vitest";
import { parseRealWorldTag } from "../../src/domain/real-world/reality.types.js";
import type { ExternalResearchSignalInput } from "../../src/domain/signal/external-signal-input.js";
import { auditService } from "../../src/services/audit.service.js";
import { problemAnalystService } from "../../src/services/problem-analyst.service.js";
import { researchSignalImportService } from "../../src/services/research-signal-import.service.js";
import { signalClusterRepository } from "../../src/db/repositories/signal-cluster.repository.js";
import { signalService } from "../../src/services/signal.service.js";
import { authActor, makeAgent } from "../helpers.js";

/**
 * Mirrors problem-analyst.test.ts's own fixture discipline exactly:
 * shared "core" tokens (so signals cluster together, similarity ~0.5 —
 * above the 0.35 join threshold) plus per-signal unique filler tokens
 * (so they stay well below the 0.85 near-duplicate threshold). `group`
 * controls sourceGroupKey for the independence tests below.
 */
function item(index: number, overrides: Partial<ExternalResearchSignalInput> = {}): ExternalResearchSignalInput {
  const core = "small business owners spend hours every month chasing overdue invoices manually";
  const filler = `topicfiller${index}a topicfiller${index}b topicfiller${index}c topicfiller${index}d topicfiller${index}e`;
  return {
    source: { id: "operator_web_search", type: "WEB", group: null },
    title: "Invoice chasing is a nightmare",
    content: `${core} ${filler}`,
    url: `https://example.com/thread/${index}`,
    observedAt: "2026-09-01T00:00:00Z",
    authorContext: `user${index}`,
    externalReference: `WebSearch result #${index}, 2026-09-05`,
    reality: "REAL",
    provenanceNote: "Read directly from the real thread URL above.",
    ...overrides,
  };
}

describe("researchSignalImportService.ingestBatch", () => {
  it("A. existing DEV_FIXTURE ingestion still works — no realWorld tag attached", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(1, { reality: "DEV_FIXTURE", provenanceNote: "" })],
      collectedByAgentId: agent.id,
    });

    expect(result.acceptedCount).toBe(1);
    const signal = await signalService.getOrThrow(result.acceptedSignalIds[0]!);
    const metadata = signal.metadata ? (JSON.parse(signal.metadata) as unknown) : null;
    expect(parseRealWorldTag(metadata)).toBeNull();
  });

  it("B. REAL_EXTERNALLY_OBSERVED ingestion is accepted when required provenance is present", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(2, { reality: "REAL", provenanceNote: "Read directly from the real forum thread." })],
      collectedByAgentId: agent.id,
      experimentId: "exp_1",
    });

    expect(result.acceptedCount).toBe(1);
    const signal = await signalService.getOrThrow(result.acceptedSignalIds[0]!);
    const metadata = signal.metadata ? (JSON.parse(signal.metadata) as unknown) : null;
    expect(parseRealWorldTag(metadata)).toEqual({ reality: "REAL", experimentId: "exp_1", note: "Read directly from the real forum thread." });
  });

  it("C. missing provenance is rejected — without crashing the rest of the batch", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(3, { reality: "REAL", provenanceNote: "" }), item(4, { reality: "DEV_FIXTURE", provenanceNote: "" })],
      collectedByAgentId: agent.id,
    });

    expect(result.rejectedCount).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/provenance note/i);
    expect(result.acceptedCount).toBe(1); // the second, valid item still went through
  });

  it("D. a REAL signal is never silently downgraded to DEV_FIXTURE", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(5, { reality: "REAL", provenanceNote: "Genuinely observed." })],
      collectedByAgentId: agent.id,
    });

    const signal = await signalService.getOrThrow(result.acceptedSignalIds[0]!);
    const metadata = signal.metadata ? (JSON.parse(signal.metadata) as unknown) : null;
    expect(parseRealWorldTag(metadata)?.reality).toBe("REAL");
  });

  it("E. re-importing the same signal is idempotent — never mutates the original", async () => {
    const agent = await makeAgent();
    const batch = { items: [item(6)], collectedByAgentId: agent.id };

    const first = await researchSignalImportService.ingestBatch(batch);
    expect(first.acceptedCount).toBe(1);
    expect(first.duplicateCount).toBe(0);
    const original = await signalService.getOrThrow(first.acceptedSignalIds[0]!);

    const second = await researchSignalImportService.ingestBatch(batch);
    expect(second.acceptedCount).toBe(0);
    expect(second.duplicateCount).toBe(1);
    expect(second.duplicates[0]!.duplicateOfSignalId).toBe(original.id);

    const afterReplay = await signalService.getOrThrow(original.id);
    expect(afterReplay.content).toBe(original.content);
    expect(afterReplay.qualityScore).toBe(original.qualityScore);
    expect(afterReplay.status).toBe(original.status);
  });

  it("F. source independence remains correct — 5 signals sharing one source group never count as 5 independent sources", async () => {
    const agent = await makeAgent();
    const sharedGroupItems = [0, 1, 2, 3, 4].map((i) => item(10 + i, { source: { id: "reddit", type: "WEB", group: "thread-A" } }));

    const result = await researchSignalImportService.ingestBatch({ items: sharedGroupItems, collectedByAgentId: agent.id });
    expect(result.acceptedCount).toBe(5);
    expect(result.touchedClusterIds).toHaveLength(1);

    const clusterAfterFive = (await signalClusterRepository.findById(result.touchedClusterIds[0]!))!;
    expect(clusterAfterFive.signalCount).toBe(5);
    expect(clusterAfterFive.independentSourceCount).toBe(1); // one shared group, not 5

    // Genuinely distinct source groups DO increase independence.
    const distinctGroupItems = [
      item(20, { source: { id: "reddit", type: "WEB", group: "thread-B" } }),
      item(21, { source: { id: "hacker_news", type: "WEB", group: "thread-C" } }),
    ];
    const secondResult = await researchSignalImportService.ingestBatch({ items: distinctGroupItems, collectedByAgentId: agent.id });
    expect(secondResult.touchedClusterIds).toEqual(result.touchedClusterIds); // same topic, same cluster

    const clusterAfterSeven = (await signalClusterRepository.findById(result.touchedClusterIds[0]!))!;
    expect(clusterAfterSeven.signalCount).toBe(7);
    expect(clusterAfterSeven.independentSourceCount).toBe(3); // thread-A, thread-B, thread-C
  });

  it("G. existing M3 intelligence (problemAnalystService) consumes an imported REAL cluster unchanged", async () => {
    const collectingAgent = await makeAgent();
    const problemAgent = await makeAgent({ role: "Problem Analyst" });

    const result = await researchSignalImportService.ingestBatch({
      items: [item(30), item(31), item(32)],
      collectedByAgentId: collectingAgent.id,
      experimentId: "exp_capstone",
    });
    expect(result.acceptedCount).toBe(3);
    expect(result.touchedClusterIds).toHaveLength(1);

    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId: result.touchedClusterIds[0]!, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.problem.status).toBe("CANDIDATE");
    expect(outcome.result?.problem.clusterId).toBe(result.touchedClusterIds[0]);
  });

  it("rejects an item with no source.id rather than storing an unattributed signal", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(40, { source: { id: "  ", type: "WEB", group: null } })],
      collectedByAgentId: agent.id,
    });
    expect(result.rejectedCount).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/source\.id is required/);
  });

  it("catches an unknown sourceType per item rather than throwing out of the batch", async () => {
    const agent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [item(41, { source: { id: "reddit", type: "NOT_A_REAL_TYPE", group: null } }), item(42)],
      collectedByAgentId: agent.id,
    });
    expect(result.rejectedCount).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/unknown signal source type/i);
    expect(result.acceptedCount).toBe(1);
  });

  it("writes one batch-level audit event summarizing the import", async () => {
    const agent = await makeAgent();
    await researchSignalImportService.ingestBatch({ items: [item(50)], collectedByAgentId: agent.id });

    const entries = await auditService.list({ resourceType: "SIGNAL_BATCH", actorId: agent.id });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.action).toBe("INGEST_RESEARCH_SIGNAL_BATCH");
  });
});

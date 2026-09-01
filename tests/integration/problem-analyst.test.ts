import { describe, expect, it } from "vitest";
import { problemAnalystService } from "../../src/services/problem-analyst.service.js";
import { signalClusteringService } from "../../src/services/signal-clustering.service.js";
import { signalService } from "../../src/services/signal.service.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { authActor, makeAgent } from "../helpers.js";

/**
 * Shares a fixed set of "core" tokens (so signals cluster together,
 * similarity ~0.5 — above the 0.35 join threshold) plus per-signal
 * unique filler tokens (so they are NOT near-duplicates of each other,
 * staying well below the 0.85 dedup threshold). See
 * domain/signal/similarity.ts — plain Jaccard token overlap, no
 * stemming, so "invoice"/"invoices" are different tokens; this keeps
 * the fixture's actual similarity in the intended range by
 * construction rather than by guessing at natural-sounding sentences.
 */
function raw(index: number): RawSourceResult {
  const core = "small business owners spend hours every month reconciling invoices manually across tools";
  const filler = `topicfiller${index}a topicfiller${index}b topicfiller${index}c topicfiller${index}d topicfiller${index}e`;
  return {
    title: "Invoicing small businesses is a nightmare",
    content: `${core} ${filler}`,
    url: `https://example.com/thread/${index}`,
    publishedAt: "2026-08-20T00:00:00Z",
    authorContext: `user${index}`,
    sourceGroupKey: null,
    metadata: {},
  };
}

async function makeCluster(agentId: string, signalCount: number) {
  let clusterId = "";
  for (let i = 0; i < signalCount; i += 1) {
    const signal = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(i), collectedByAgentId: agentId });
    const cluster = await signalClusteringService.assign(signal.id);
    clusterId = cluster.id;
  }
  return clusterId;
}

describe("problemAnalystService", () => {
  it("promotes a well-corroborated cluster to a CANDIDATE Problem with a clamped, real evidenceCount", async () => {
    const collectingAgent = await makeAgent();
    const problemAgent = await makeAgent({ role: "Problem Analyst" });
    const clusterId = await makeCluster(collectingAgent.id, 3);

    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.problem.status).toBe("CANDIDATE");
    expect(outcome.result?.problem.clusterId).toBe(clusterId);
    expect(outcome.result?.problem.evidenceCount).toBeLessThanOrEqual(3); // never exceeds the real signal count
  });

  it("marks a thin, single-signal cluster INSUFFICIENT_EVIDENCE rather than manufacturing a promotable Problem (Part 43)", async () => {
    const collectingAgent = await makeAgent();
    const problemAgent = await makeAgent({ role: "Problem Analyst" });
    const clusterId = await makeCluster(collectingAgent.id, 1);

    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.problem.status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("stays within its bounded budget — no tool calls, at most one model call", async () => {
    const collectingAgent = await makeAgent();
    const problemAgent = await makeAgent({ role: "Problem Analyst" });
    const clusterId = await makeCluster(collectingAgent.id, 2);

    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId, startedBy: authActor() });

    expect(outcome.execution.toolCallCount).toBe(0);
    expect(outcome.execution.modelCallCount).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import { opportunityAnalystService } from "../../src/services/opportunity-analyst.service.js";
import { researchQueueService } from "../../src/services/research-queue.service.js";
import { signalClusteringService } from "../../src/services/signal-clustering.service.js";
import { signalService } from "../../src/services/signal.service.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { authActor, makeAgent, makeProblem } from "../helpers.js";

/** See tests/integration/problem-analyst.test.ts's raw() for why this
 *  shape is used instead of hand-varied natural sentences. */
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

async function generateOpportunity() {
  const collectingAgent = await makeAgent();
  let clusterId = "";
  for (let i = 0; i < 2; i += 1) {
    const signal = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(i), collectedByAgentId: collectingAgent.id });
    const cluster = await signalClusteringService.assign(signal.id);
    clusterId = cluster.id;
  }
  const problem = await makeProblem({ clusterId, collectedByAgentId: collectingAgent.id });
  const analystAgent = await makeAgent({ role: "Opportunity Analyst" });
  const outcome = await opportunityAnalystService.run({
    agentId: analystAgent.id,
    problemId: problem.id,
    marketAnalysis: { wtpSignals: [], marketTiming: "unclear", marketSizeQualitative: "unclear" },
    startedBy: authActor(),
  });
  return outcome.result!.opportunity;
}

describe("researchQueueService", () => {
  it("populates one queue item per unresolved evidence gap, each traceable back to its gap and opportunity", async () => {
    const opportunity = await generateOpportunity();

    const items = await researchQueueService.populateForOpportunity(opportunity.id);

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.opportunityId).toBe(opportunity.id);
      expect(item.evidenceGapId).not.toBeNull();
      expect(item.kind).toBe("RESOLVE_EVIDENCE_GAP");
      expect(item.status).toBe("PENDING");
    }
  });

  it("next() returns the single highest-priority pending item, not simply the first one created", async () => {
    const opportunity = await generateOpportunity();
    await researchQueueService.populateForOpportunity(opportunity.id);

    const all = await researchQueueService.list({ status: "PENDING" });
    const next = await researchQueueService.next();

    expect(next).not.toBeNull();
    const maxPriority = Math.max(...all.map((item) => item.priorityScore));
    expect(next?.priorityScore).toBe(maxPriority);
  });

  it("markDone/markSkipped move an item out of the pending pool", async () => {
    const opportunity = await generateOpportunity();
    const [item] = await researchQueueService.populateForOpportunity(opportunity.id);

    await researchQueueService.markInProgress(item!.id);
    await researchQueueService.markDone(item!.id);

    const pending = await researchQueueService.list({ status: "PENDING" });
    expect(pending.find((i) => i.id === item!.id)).toBeUndefined();
  });
});

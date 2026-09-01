import { describe, expect, it } from "vitest";
import { evidenceGapService } from "../../src/services/evidence-gap.service.js";
import { opportunityAnalystService } from "../../src/services/opportunity-analyst.service.js";
import { signalClusteringService } from "../../src/services/signal-clustering.service.js";
import { signalService } from "../../src/services/signal.service.js";
import type { RawSourceResult } from "../../src/sources/research-source.js";
import { authActor, makeAgent, makeProblem } from "../helpers.js";

/** See tests/integration/problem-analyst.test.ts's raw() for why this
 *  shape (fixed core tokens + unique-per-signal filler tokens) is used
 *  instead of hand-varied natural sentences — it puts signals reliably
 *  above the cluster-join threshold without becoming near-duplicates
 *  of each other, by construction against the plain-Jaccard similarity
 *  function (no stemming). */
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

async function problemWithRealSignals(signalCount: number) {
  const collectingAgent = await makeAgent();
  let clusterId = "";
  for (let i = 0; i < signalCount; i += 1) {
    const signal = await signalService.ingest({ source: "hacker_news", sourceType: "WEB", raw: raw(i), collectedByAgentId: collectingAgent.id });
    const cluster = await signalClusteringService.assign(signal.id);
    clusterId = cluster.id;
  }
  return makeProblem({ clusterId, evidenceCount: signalCount, collectedByAgentId: collectingAgent.id });
}

const marketAnalysis = { wtpSignals: ["A comparable tool charges $20/month"], marketTiming: "steady demand", marketSizeQualitative: "moderate" };

describe("opportunityAnalystService", () => {
  it("generates a traceable Opportunity with score, kill-risk, and evidence promoted from real signals", async () => {
    const problem = await problemWithRealSignals(3);
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    const outcome = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: problem.id, marketAnalysis, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    const opportunity = outcome.result!.opportunity;
    expect(opportunity.problemId).toBe(problem.id);
    expect(opportunity.opportunityScore).not.toBeNull();
    expect(opportunity.confidenceScore).not.toBeNull();
    expect(opportunity.status).toBe("DISCOVERED"); // never auto-validated

    // Traceability: real Evidence rows exist, linked back to the real signals.
    const { opportunityService } = await import("../../src/services/opportunity.service.js");
    const evidence = await opportunityService.listEvidence(opportunity.id);
    expect(evidence.length).toBeGreaterThan(0);
    for (const item of evidence) {
      expect(item.signalId).not.toBeNull();
    }
  });

  it("promotes each signal to Evidence idempotently — a second opportunity from the same problem reuses the same Evidence rows", async () => {
    const problem = await problemWithRealSignals(2);
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    const first = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: problem.id, marketAnalysis, startedBy: authActor() });
    const second = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: problem.id, marketAnalysis, startedBy: authActor() });

    const { opportunityService } = await import("../../src/services/opportunity.service.js");
    const firstEvidence = await opportunityService.listEvidence(first.result!.opportunity.id);
    const secondEvidence = await opportunityService.listEvidence(second.result!.opportunity.id);
    expect(secondEvidence.map((e) => e.id).sort()).toEqual(firstEvidence.map((e) => e.id).sort());
  });

  it("produces evidence gaps and a next-best-research-question from the analyst's own dimension grounding", async () => {
    const problem = await problemWithRealSignals(2);
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    const outcome = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: problem.id, marketAnalysis, startedBy: authActor() });
    const opportunity = outcome.result!.opportunity;

    const gaps = await evidenceGapService.listForOpportunity(opportunity.id);
    expect(gaps.length).toBeGreaterThan(0);
    const refreshed = await (await import("../../src/services/opportunity.service.js")).opportunityService.getOrThrow(opportunity.id);
    expect(refreshed.nextBestResearchQuestion).toBeTruthy();
  });

  it("promotes the underlying Problem to PROMOTED once an Opportunity is generated from it", async () => {
    const problem = await problemWithRealSignals(2);
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: problem.id, marketAnalysis, startedBy: authActor() });

    const { problemService } = await import("../../src/services/problem.service.js");
    const refreshed = await problemService.getOrThrow(problem.id);
    expect(refreshed.status).toBe("PROMOTED");
  });
});

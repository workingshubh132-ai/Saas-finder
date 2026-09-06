import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import type { ExternalResearchSignalInput } from "../../src/domain/signal/external-signal-input.js";
import { opportunityAnalystService } from "../../src/services/opportunity-analyst.service.js";
import { problemAnalystService } from "../../src/services/problem-analyst.service.js";
import { researchSignalImportService } from "../../src/services/research-signal-import.service.js";
import { authActor, makeAgent, makeOpportunity, makeProblem } from "../helpers.js";

/**
 * Same fixture discipline as problem-analyst.test.ts / research-signal-import.test.ts:
 * shared "core" tokens keep signals above the 0.35 cluster-join threshold;
 * unique-per-signal filler tokens keep them below the 0.85 near-duplicate
 * threshold, all by construction against the plain-Jaccard similarity function.
 */
function item(index: number, overrides: Partial<ExternalResearchSignalInput> = {}): ExternalResearchSignalInput {
  const core = "bank payments do not reliably match invoices or customers for small business finance teams";
  const filler = `topicfiller${index}a topicfiller${index}b topicfiller${index}c topicfiller${index}d topicfiller${index}e`;
  return {
    source: { id: "operator_web_search", type: "WEB", group: null },
    title: "Bank payments don't reliably match invoices",
    content: `${core} ${filler}`,
    url: `https://example.com/thread/${index}`,
    observedAt: "2026-09-01T00:00:00Z",
    authorContext: `user${index}`,
    externalReference: `Test fixture signal #${index}`,
    reality: "REAL",
    provenanceNote: "Read directly from the real thread URL above.",
    ...overrides,
  };
}

const marketAnalysis = { wtpSignals: ["A comparable tool charges $20/month"], marketTiming: "steady demand", marketSizeQualitative: "moderate" };

describe("upstream promotion path — REAL evidence, independence, and the Opportunity gate", () => {
  it("A. two genuinely independent REAL signals corroborate the same Problem", async () => {
    const collectingAgent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [
        item(1, { source: { id: "reddit", type: "WEB", group: "thread-A" } }),
        item(2, { source: { id: "hacker_news", type: "WEB", group: "thread-B" } }),
      ],
      collectedByAgentId: collectingAgent.id,
      experimentId: "exp_payment_reconciliation",
    });
    expect(result.acceptedCount).toBe(2);
    expect(result.touchedClusterIds).toHaveLength(1);

    const assessment = await researchSignalImportService.assessClusterRealEvidence(result.touchedClusterIds[0]!);
    expect(assessment.realIndependentSourceCount).toBe(2);
    expect(assessment.meetsRealEvidenceThreshold).toBe(true);

    const problemAgent = await makeAgent({ role: "Problem Analyst" });
    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId: result.touchedClusterIds[0]!, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.problem.status).toBe("CANDIDATE");
  });

  it("B. two URLs from the same underlying source do NOT count as independent", async () => {
    const collectingAgent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [
        item(3, { source: { id: "reddit", type: "WEB", group: "thread-A" }, url: "https://reddit.com/r/smallbusiness/thread-A" }),
        item(4, { source: { id: "reddit", type: "WEB", group: "thread-A" }, url: "https://mirror-site.example.com/copy-of-thread-A" }),
      ],
      collectedByAgentId: collectingAgent.id,
    });
    expect(result.acceptedCount).toBe(2); // both accepted as distinct signals — different URLs, so signalService's own exact-dedup doesn't reject either
    expect(result.touchedClusterIds).toHaveLength(1);

    const assessment = await researchSignalImportService.assessClusterRealEvidence(result.touchedClusterIds[0]!);
    expect(assessment.independentSourceCount).toBe(1); // same sourceGroupKey "thread-A" (a mirrored post) — one source, not two
    expect(assessment.realIndependentSourceCount).toBe(1);
    expect(assessment.meetsRealEvidenceThreshold).toBe(false);

    const problemAgent = await makeAgent({ role: "Problem Analyst" });
    const outcome = await problemAnalystService.run({ agentId: problemAgent.id, clusterId: result.touchedClusterIds[0]!, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result?.problem.status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("C. REAL + DEV_FIXTURE does not satisfy the REAL evidence threshold, even though the general independent-source count says 2", async () => {
    const collectingAgent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [
        item(5, { source: { id: "reddit", type: "WEB", group: "thread-A" }, reality: "REAL" }),
        item(6, { source: { id: "hacker_news", type: "WEB", group: "thread-B" }, reality: "DEV_FIXTURE", provenanceNote: "" }),
      ],
      collectedByAgentId: collectingAgent.id,
    });
    expect(result.acceptedCount).toBe(2);
    expect(result.touchedClusterIds).toHaveLength(1);

    const assessment = await researchSignalImportService.assessClusterRealEvidence(result.touchedClusterIds[0]!);
    expect(assessment.independentSourceCount).toBe(2); // the general, reality-blind aggregate — unchanged, by design
    expect(assessment.realIndependentSourceCount).toBe(1); // only the REAL signal counts
    expect(assessment.meetsRealEvidenceThreshold).toBe(false);
  });

  it("D. signals with no REAL tag (DEV_FIXTURE or untagged) cannot satisfy the REAL evidence threshold on their own, however independent they look", async () => {
    const collectingAgent = await makeAgent();
    const result = await researchSignalImportService.ingestBatch({
      items: [
        item(7, { source: { id: "reddit", type: "WEB", group: "thread-A" }, reality: "DEV_FIXTURE", provenanceNote: "" }),
        item(8, { source: { id: "hacker_news", type: "WEB", group: "thread-B" }, reality: "DEV_FIXTURE", provenanceNote: "" }),
      ],
      collectedByAgentId: collectingAgent.id,
    });
    expect(result.acceptedCount).toBe(2);

    const assessment = await researchSignalImportService.assessClusterRealEvidence(result.touchedClusterIds[0]!);
    expect(assessment.independentSourceCount).toBe(2); // 2 distinct groups, naively "independent"
    expect(assessment.realIndependentSourceCount).toBe(0); // none of them REAL — never counted as real evidence
    expect(assessment.meetsRealEvidenceThreshold).toBe(false);
  });

  it("E. a Problem below the evidence threshold cannot produce a real Opportunity — refused before any write, not merely left FAILED after one", async () => {
    const insufficientProblem = await makeProblem({ status: "INSUFFICIENT_EVIDENCE", evidenceCount: 1, confidence: 0.6 });
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    const outcome = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: insufficientProblem.id, marketAnalysis, startedBy: authActor() });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("VALIDATION_ERROR");

    const orphanedOpportunity = await prisma.opportunity.findFirst({ where: { problemId: insufficientProblem.id } });
    expect(orphanedOpportunity).toBeNull(); // no dangling Opportunity left behind by the refused attempt

    const refreshedProblem = await prisma.problem.findUnique({ where: { id: insufficientProblem.id } });
    expect(refreshedProblem!.status).toBe("INSUFFICIENT_EVIDENCE"); // untouched — no partial transition either
  });

  it("F. a Problem meeting the existing threshold progresses through the existing, unmodified Opportunity creation path", async () => {
    const candidateProblem = await makeProblem({ status: "CANDIDATE", evidenceCount: 2, confidence: 0.6 });
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });

    const outcome = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: candidateProblem.id, marketAnalysis, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result!.opportunity.problemId).toBe(candidateProblem.id);
    const refreshedProblem = await prisma.problem.findUnique({ where: { id: candidateProblem.id } });
    expect(refreshedProblem!.status).toBe("PROMOTED");
  });

  it("G. a newly created REAL opportunity never mutates or merges with an existing, unrelated opportunity", async () => {
    const preExisting = await makeOpportunity({ title: "[DEV FIXTURE] Unrelated bootstrap opportunity" });
    const beforeCount = await prisma.opportunity.count();

    const candidateProblem = await makeProblem({ status: "CANDIDATE", evidenceCount: 2, confidence: 0.6 });
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });
    const outcome = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: candidateProblem.id, marketAnalysis, startedBy: authActor() });

    const afterCount = await prisma.opportunity.count();
    expect(afterCount).toBe(beforeCount + 1);
    expect(outcome.result!.opportunity.id).not.toBe(preExisting.id);
    expect(outcome.result!.opportunity.problemId).toBe(candidateProblem.id);

    const refreshedPreExisting = await prisma.opportunity.findUnique({ where: { id: preExisting.id } });
    expect(refreshedPreExisting!.title).toBe(preExisting.title); // untouched
    expect(refreshedPreExisting!.problemId).toBe(preExisting.problemId); // never re-pointed at the new problem
  });

  it("H. the pipeline stays idempotent — re-importing a signal never inflates independence, and re-running opportunity generation reuses evidence rather than duplicating it", async () => {
    const collectingAgent = await makeAgent();
    const firstItem = item(9, { source: { id: "reddit", type: "WEB", group: "thread-A" } });
    const firstImport = await researchSignalImportService.ingestBatch({ items: [firstItem], collectedByAgentId: collectingAgent.id });
    expect(firstImport.acceptedCount).toBe(1);
    const clusterId = firstImport.touchedClusterIds[0]!;

    const secondImport = await researchSignalImportService.ingestBatch({ items: [firstItem], collectedByAgentId: collectingAgent.id });
    expect(secondImport.acceptedCount).toBe(0);
    expect(secondImport.duplicateCount).toBe(1);
    const assessment = await researchSignalImportService.assessClusterRealEvidence(clusterId);
    expect(assessment.realIndependentSourceCount).toBe(1); // the duplicate re-import never inflated it

    const candidateProblem = await makeProblem({ clusterId, status: "CANDIDATE", evidenceCount: 1, confidence: 0.6, collectedByAgentId: collectingAgent.id });
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });
    const first = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: candidateProblem.id, marketAnalysis, startedBy: authActor() });
    const second = await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: candidateProblem.id, marketAnalysis, startedBy: authActor() });

    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("COMPLETED"); // PROMOTED stays explicitly allowed to re-run (a Problem may spawn more than one Opportunity framing)
    const { opportunityService } = await import("../../src/services/opportunity.service.js");
    const firstEvidence = await opportunityService.listEvidence(first.result!.opportunity.id);
    const secondEvidence = await opportunityService.listEvidence(second.result!.opportunity.id);
    expect(firstEvidence.length).toBeGreaterThan(0);
    expect(secondEvidence.map((e) => e.id).sort()).toEqual(firstEvidence.map((e) => e.id).sort());
  });

  it("I. no OutreachMessageDelivery is ever created by this upstream promotion path", async () => {
    const candidateProblem = await makeProblem({ status: "CANDIDATE", evidenceCount: 2, confidence: 0.6 });
    const analystAgent = await makeAgent({ role: "Opportunity Analyst" });
    await opportunityAnalystService.run({ agentId: analystAgent.id, problemId: candidateProblem.id, marketAnalysis, startedBy: authActor() });

    const deliveries = await prisma.outreachMessageDelivery.count();
    expect(deliveries).toBe(0);
  });
});

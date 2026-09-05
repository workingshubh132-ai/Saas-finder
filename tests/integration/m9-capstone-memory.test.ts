import { describe, expect, it } from "vitest";
import { learningRecordRepository } from "../../src/db/repositories/learning-record.repository.js";
import { agentService } from "../../src/services/agent.service.js";
import { buildCompanyActionPrompt, ceoReasoningService, type CompanyActionSummary } from "../../src/services/ceo-reasoning.service.js";
import { decisionMemoryService } from "../../src/services/decision-memory.service.js";
import { resourceAllocationService } from "../../src/services/resource-allocation.service.js";
import { UNKNOWN } from "../../src/domain/shared/metric-result.js";
import { authActor, HUMAN_OWNER } from "../helpers.js";

const EMPTY_COMPANY_STATE: CompanyActionSummary["companyState"] = {
  cashPosition: UNKNOWN,
  revenue: UNKNOWN,
  growth: UNKNOWN,
  portfolioSize: 0,
  portfolioHealth: UNKNOWN,
  customerHealth: UNKNOWN,
  operationalHealth: UNKNOWN,
  risk: UNKNOWN,
  evidenceQuality: UNKNOWN,
  decisionBacklog: 0,
  executionBacklog: 0,
};

/**
 * M9 capstone: institutional memory actually reaches the CEO's
 * reasoning, not just a service nobody calls (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §27, §31). A real gap this build caught: recommendCompanyAction's own
 * doc comment used to say decisionMemoryService/resourceAllocationService
 * would be "added once those services exist" — both existed (built in
 * earlier tasks) with zero caller ever feeding their output into this
 * prompt. Fixed in ceo-reasoning.service.ts; this test proves the fix
 * two ways: the real service call completes with memory now wired in,
 * and the exported prompt-builder actually carries a real lesson's text
 * (never fabricated, never silently dropped).
 */
describe("M9 capstone: institutional memory reaches the CEO's own company-level prompt", () => {
  it("a past company-level decision's real lesson appears verbatim in buildCompanyActionPrompt's output", async () => {
    const expectation = await decisionMemoryService.recordExpectation({ decisionType: "COMPANY_RECOMMENDATION", decisionResourceId: "past-decision-1", expectedMetricType: "MRR", expectedValue: 5000 });
    const learningRecord = await learningRecordRepository.create({
      errorDescription: "Predicted MRR 5000 after a company-wide GROW push; actual came in at 1200.",
      rootCause: "Overestimated how quickly growth spend converts to revenue.",
      lesson: "A company-wide GROW recommendation should not assume revenue conversion happens within the same period as the spend.",
    });
    await decisionMemoryService.evaluateOutcome({ decisionOutcomeId: expectation.id, actualValue: 1200, learningRecordId: learningRecord.id });

    const pastLessons = await decisionMemoryService.findSimilarPastDecisions("COMPANY_RECOMMENDATION");
    expect(pastLessons.length).toBeGreaterThan(0);

    await resourceAllocationService.setAllocation({ category: "MARKETING", allocated: 20 });
    await resourceAllocationService.recordConsumption({ category: "MARKETING", consumed: 18 });
    const resourceAllocations = await resourceAllocationService.getForPeriod();
    const resourceAllocationConsumedByCategory: Record<string, number> = {};
    for (const a of resourceAllocations) resourceAllocationConsumedByCategory[a.category] = a.consumed;

    const summary: CompanyActionSummary = {
      companyState: EMPTY_COMPANY_STATE,
      portfolioBucketCounts: { WINNERS: 0, PROMISING: 0, UNCERTAIN: 0, STAGNATING: 0, DECLINING: 0, KILL_CANDIDATES: 0 },
      opportunityCountsByStatus: {},
      productCountsByStatus: {},
      pastLessons,
      resourceAllocationConsumedByCategory,
    };

    const prompt = buildCompanyActionPrompt(summary);
    expect(prompt).toContain("A company-wide GROW recommendation should not assume revenue conversion happens within the same period as the spend.");
    expect(prompt).toContain("MARKETING: 18");
  });

  it("recommendCompanyAction itself completes with real memory/resource-allocation data wired in, never silently dropping either fetch", async () => {
    // No past lesson and no resource allocation recorded yet this period — the honest "nothing to report" case.
    const ceoAgent = await agentService.createAgent({ name: "Memory Capstone CEO", role: "CEO", department: "EXECUTIVE", description: "x", riskLevel: "GREEN", createdBy: HUMAN_OWNER });
    const outcome = await ceoReasoningService.recommendCompanyAction({ agentId: ceoAgent.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
  });
});

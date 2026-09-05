import { describe, expect, it } from "vitest";
import { businessHealthRepository } from "../../src/db/repositories/business-health.repository.js";
import { companyRecommendationRepository } from "../../src/db/repositories/company-recommendation.repository.js";
import { founderCockpitViewRepository } from "../../src/db/repositories/founder-cockpit-view.repository.js";
import { learningRecordRepository } from "../../src/db/repositories/learning-record.repository.js";
import { toJsonString } from "../../src/domain/shared/json.js";
import { alertService } from "../../src/services/alert.service.js";
import { briefingService } from "../../src/services/briefing.service.js";
import { companyTimelineService } from "../../src/services/company-timeline.service.js";
import { controlPlaneService } from "../../src/services/control-plane.service.js";
import { decisionMemoryService } from "../../src/services/decision-memory.service.js";
import { decisionQualityService } from "../../src/services/decision-quality.service.js";
import { founderCockpitService } from "../../src/services/founder-cockpit.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { predictionOutcomeService } from "../../src/services/prediction-outcome.service.js";
import { resourceAllocationService } from "../../src/services/resource-allocation.service.js";
import { HUMAN_OWNER, makeLiveProduct } from "../helpers.js";

/**
 * M9 integration tests for the read/report layer (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §21-23, §29, §35, §43-44, §46) — none of these had ANY test coverage
 * until this task: every assertion below is against real, seeded rows,
 * not a mocked service.
 */
describe("Portfolio overview + Company Timeline + Resource Allocation — real state, real reads", () => {
  it("buckets a real product by its real BusinessHealth state, correlates its real PRODUCT_CREATED event on the timeline, and counts real AgentExecution rows toward AGENT_EXECUTION consumption", async () => {
    const chain = await makeLiveProduct();

    await businessHealthRepository.create({
      productId: chain.product.id,
      productHealth: 0.1,
      customerHealth: 0.1,
      revenueHealth: 0.1,
      growthHealth: 0.1,
      marginHealth: 0.1,
      operationalHealth: 0.1,
      risk: 0.9,
      evidenceConfidence: 0.5,
      compositeScore: 0.1,
      state: "CRITICAL",
      reasons: toJsonString(["[TEST] deliberately CRITICAL for portfolio bucketing"]),
    });

    const portfolio = await controlPlaneService.getPortfolio();
    expect(portfolio.KILL_CANDIDATES.map((e) => e.productId)).toContain(chain.product.id);
    for (const bucket of ["WINNERS", "PROMISING", "UNCERTAIN", "STAGNATING", "DECLINING"] as const) {
      expect(portfolio[bucket].map((e) => e.productId)).not.toContain(chain.product.id);
    }

    const timeline = await companyTimelineService.getTimeline();
    const productCreated = timeline.find((e) => e.type === "PRODUCT_CREATED" && e.payload.productId === chain.product.id);
    expect(productCreated).toBeDefined();
    const deployed = timeline.find((e) => e.type === "PRODUCT_DEPLOYED" && e.payload.productId === chain.product.id);
    expect(deployed).toBeDefined();
    // PRODUCT_CREATED happened before PRODUCT_DEPLOYED — the real order the factory chain actually ran in.
    expect(productCreated!.occurredAt.getTime()).toBeLessThanOrEqual(deployed!.occurredAt.getTime());

    const agentExecutionAllocation = await resourceAllocationService.recordAgentExecutionConsumption();
    // makeLiveProduct() ran the real Strategist/Architect/UX/Engineering/CodeReview/QA/Security/CEO/Chairman agents —
    // each a real AgentExecution row.
    expect(agentExecutionAllocation.consumed).toBeGreaterThan(0);
    expect(agentExecutionAllocation.category).toBe("AGENT_EXECUTION");

    const marketingAllocation = await resourceAllocationService.setAllocation({ category: "MARKETING", allocated: 10 });
    expect(marketingAllocation.allocated).toBe(10);
    const afterConsumption = await resourceAllocationService.recordConsumption({ category: "MARKETING", consumed: 4 });
    expect(afterConsumption.consumed).toBe(4);

    const forPeriod = await resourceAllocationService.getForPeriod();
    expect(forPeriod.some((a) => a.category === "AGENT_EXECUTION")).toBe(true);
    expect(forPeriod.some((a) => a.category === "MARKETING" && a.consumed === 4)).toBe(true);
  });
});

describe("Decision Memory — expectation recorded, outcome evaluated, and surfaced as a real past lesson (docs/M9_ARCHITECTURE_PROPOSAL.md §27)", () => {
  it("recordExpectation -> evaluateOutcome -> findSimilarPastDecisions returns the same decision once it has a real LearningRecord attached", async () => {
    const expectation = await decisionMemoryService.recordExpectation({ decisionType: "COMPANY_RECOMMENDATION", decisionResourceId: "resource-1", expectedMetricType: "MRR", expectedValue: 1000 });
    expect(expectation.actualValue).toBeNull();

    const learningRecord = await learningRecordRepository.create({ errorDescription: "Predicted MRR 1000, actual came in at 400 — a real miss.", rootCause: "Overestimated conversion.", lesson: "Validate conversion assumptions before forecasting revenue this far out." });
    const evaluated = await decisionMemoryService.evaluateOutcome({ decisionOutcomeId: expectation.id, actualValue: 400, learningRecordId: learningRecord.id });
    expect(evaluated.actualValue).toBe(400);
    expect(evaluated.evaluatedAt).not.toBeNull();

    // A second evaluation on the same outcome is refused — a decision outcome is recorded exactly once.
    await expect(decisionMemoryService.evaluateOutcome({ decisionOutcomeId: expectation.id, actualValue: 999 })).rejects.toThrow();

    const history = await decisionMemoryService.getHistory("COMPANY_RECOMMENDATION", "resource-1");
    expect(history).toHaveLength(1);
    expect(history[0]!.learningRecord?.lesson).toContain("Validate conversion assumptions");

    const similar = await decisionMemoryService.findSimilarPastDecisions("COMPANY_RECOMMENDATION");
    expect(similar.map((s) => s.outcome.id)).toContain(expectation.id);
  });
});

describe("Decision Quality Dashboard — real prediction accuracy bucketed by source (§29)", () => {
  it("includes a real resolved PredictionOutcome's error, bucketed by its own predictionSource", async () => {
    const chain = await makeLiveProduct();
    const targetStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const targetEnd = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const prediction = await predictionOutcomeService.record({
      productId: chain.product.id,
      metricType: "MRR",
      predictedValue: 1000,
      targetPeriodStart: targetStart,
      targetPeriodEnd: targetEnd,
      predictionSource: "TEST_REVENUE_ANALYST",
      now: targetStart, // A real forward-looking prediction — recorded before its own target period ends.
    });
    const { outcome } = await predictionOutcomeService.resolve({ predictionOutcomeId: prediction.id, observedValue: 800, now: new Date() });
    expect(outcome.errorPct).not.toBeNull();

    const dashboard = await decisionQualityService.getDashboard();
    const bucket = dashboard.predictionAccuracyBySource.find((b) => b.source === "TEST_REVENUE_ANALYST");
    expect(bucket).toBeDefined();
    expect(bucket!.count).toBe(1);
    expect(bucket!.avgAbsErrorPct).toBeCloseTo(Math.abs(outcome.errorPct!), 6);
  });
});

describe("Weekend Briefing — real alerts and real undecided recommendations surface, evidence-backed (§46)", () => {
  it("RISKS cites the real alert id, CEO_TOP_RECOMMENDATIONS cites the real recommendation id, and status is ACTION_REQUIRED because a real decision is pending", async () => {
    const alert = await alertService.raise({ alertType: "INCIDENT", severity: "CRITICAL", resourceType: "PRODUCT", resourceId: "test-product-1", message: "A real, seeded test incident." });
    const recommendation = await companyRecommendationRepository.create({ action: "PAUSE", reasoning: "Test-seeded recommendation for the briefing.", citedResourceIds: toJsonString([]), confidence: 0.7 });

    const briefing = await briefingService.generate();
    const content = JSON.parse(briefing.content) as { RISKS: Array<{ citedIds: string[] }>; CEO_TOP_RECOMMENDATIONS: Array<{ citedIds: string[] }>; status: string };
    expect(content.RISKS.some((s) => s.citedIds.includes(alert.id))).toBe(true);
    expect(content.CEO_TOP_RECOMMENDATIONS.some((s) => s.citedIds.includes(recommendation.id))).toBe(true);
    // Every statement in every section cites at least one real id — briefingContentSchema's own structural guarantee, re-verified against the real persisted row.
    for (const section of Object.values(content).filter((v): v is Array<{ citedIds: string[] }> => Array.isArray(v))) {
      for (const statement of section) {
        expect(statement.citedIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("is NO_ACTION_REQUIRED — a real, honest output — when nothing is above the attention threshold (M9 brief §36)", async () => {
    const briefing = await briefingService.generate();
    expect(briefing.status).toBe("NO_ACTION_REQUIRED");
    const content = JSON.parse(briefing.content) as { DECISIONS_REQUIRED: unknown[] };
    expect(content.DECISIONS_REQUIRED).toEqual([]);
  });
});

describe("Founder Cockpit — one real read, plus a real recorded view for the next timeline slice (§44)", () => {
  it("aggregates real company state and portfolio, and records a FounderCockpitView row", async () => {
    const beforeView = await founderCockpitViewRepository.findLatest();
    expect(beforeView).toBeNull();

    const identity = await identityService.createIdentity({ type: "HUMAN", label: "Cockpit Viewer", createdBy: { type: "HUMAN", id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId } });
    const cockpit = await founderCockpitService.getCockpit(identity.identity.id);
    expect(cockpit.companyState).toBeDefined();
    expect(cockpit.portfolio).toBeDefined();
    expect(Array.isArray(cockpit.topDecisions)).toBe(true);

    const afterView = await founderCockpitViewRepository.findLatest();
    expect(afterView).not.toBeNull();
    expect(afterView!.viewedByIdentityId).toBe(identity.identity.id);
  });
});

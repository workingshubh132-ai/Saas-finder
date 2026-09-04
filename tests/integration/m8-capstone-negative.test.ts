import { describe, expect, it } from "vitest";
import { businessIntelligenceService } from "../../src/services/business-intelligence.service.js";
import { authActor, makeLiveProduct } from "../helpers.js";

/**
 * The negative M8 capstone (docs/M8_ARCHITECTURE_PROPOSAL.md §1, M8
 * brief §52 "No Fake Traction"): a product that has JUST gone LIVE,
 * with zero real usage, revenue, or customer signal, must never be
 * read as healthy, never recommended for investment, and never
 * silently skipped — it must honestly surface as EARLY, low
 * confidence, and grounded in exactly what little evidence exists.
 * No seeding happens here at all — this is the true zero-data floor
 * every LIVE product starts at.
 */
describe("M8 capstone: negative — a fresh LIVE product with zero real signal never fakes traction", () => {
  it("zero usage/revenue/customer data produces an honest low-confidence read, never a fabricated INVEST", async () => {
    const chain = await makeLiveProduct();
    const { agents, product } = chain;

    const summary = await businessIntelligenceService.analyze({
      productId: product.id,
      productIntelligenceAgentId: agents.productIntelligenceAgent.id,
      revenueAnalystAgentId: agents.revenueAnalystAgent.id,
      growthAnalystAgentId: agents.growthAnalystAgent.id,
      customerIntelligenceAgentId: agents.customerIntelligenceAgent.id,
      ceoAgentId: agents.ceoAgent.id,
      startedBy: authActor(),
    });

    expect(summary.stoppedReason).toBeNull();
    expect(summary.businessHealth).not.toBeNull();
    // Every one of the four intelligence agents' own "insufficient data" confidence is exactly 0.3 — the
    // true zero-evidence floor (docs/DECISIONS.md's own EARLY_EVIDENCE_THRESHOLD=0.35 recalibration).
    expect(summary.businessHealth!.evidenceConfidence).toBeCloseTo(0.3, 5);
    expect(summary.businessHealth!.state).toBe("EARLY");

    // Never INVEST — there is no real evidence to ground it, and the CEO must never manufacture confidence.
    expect(summary.ceoRecommendation).not.toBeNull();
    expect(summary.ceoRecommendation!.action).not.toBe("INVEST");
    expect(summary.ceoRecommendation!.confidence).toBeLessThanOrEqual(0.6);

    // Still fully auditable — a real recommendation grounded in real (if minimal) claims, never an empty escalation.
    const citedClaimIds = JSON.parse(summary.ceoRecommendation!.citedClaimIds) as string[];
    expect(citedClaimIds.length).toBeGreaterThan(0);

    expect(summary.memo).not.toBeNull();
    expect(summary.memo!.recommendation).toBe(summary.ceoRecommendation!.action);
  });
});

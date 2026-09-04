import { describe, expect, it } from "vitest";
import { businessIntelligenceService } from "../../src/services/business-intelligence.service.js";
import { businessReviewMemoService } from "../../src/services/business-review-memo.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { productService } from "../../src/services/product.service.js";
import type { OpportunityScoreDimensions } from "../../src/services/opportunity-scorer.js";
import type { KillRiskDimensions } from "../../src/services/kill-risk-scorer.js";
import { authActor, HUMAN_OWNER, makeLiveProduct, seedActivationDefinition, seedCustomerFeedback, seedRevenueData, seedUsageCohort } from "../helpers.js";

const ELEVATED_SCORE_DIMENSIONS: OpportunityScoreDimensions = {
  pain: 0.3,
  demand: 0.3,
  willingnessToPay: 0.2,
  reachability: 0.3,
  retention: 0.2,
  differentiation: 0.2,
  buildability: 0.5,
  economics: 0.2,
  risk: 0.8,
  evidenceQuality: 0.3,
  marketSize: 0.3,
  frequency: 0.3,
  evidenceIndependence: 0.3,
  timing: 0.3,
};

/** Every dimension elevated — simulates an opportunity that was already borderline-risky before launch (docs/M8_ARCHITECTURE_PROPOSAL.md §27's 30/70 prior/observed blend needs a real, elevated prior to reach PREPARE_KILL_REVIEW; see kill-intelligence.service.ts's own documented 0..0.713 achievable range). */
const ELEVATED_KILL_RISK_DIMENSIONS: KillRiskDimensions = {
  weakDemand: 0.9,
  weakWillingnessToPay: 0.9,
  crowdedMarket: 0.9,
  poorDifferentiation: 0.9,
  badDistribution: 0.9,
  technicalDifficulty: 0.9,
  regulatoryRisk: 0.9,
  platformDependency: 0.9,
  lowRetention: 0.9,
  lowMargins: 0.9,
  insufficientEvidence: 0.9,
};

/**
 * The kill M8 capstone (docs/M8_ARCHITECTURE_PROPOSAL.md §1, §27, M8
 * brief §55): a LIVE product with real, observed decline — falling
 * signups, full revenue churn, weak activation, and recurring negative
 * feedback, layered on an opportunity that was already elevated-risk
 * at scoring time — reaches PREPARE_KILL_REVIEW through the SAME
 * DeterministicKillRiskScorer M3/M4 already built (never a second,
 * independent kill architecture — M8 brief §27's own explicit
 * instruction), and a human APPROVE decision on the resulting memo
 * moves the product from LIVE to PAUSED — a real, reversible,
 * already-existing transition, never an autonomous kill.
 */
describe("M8 capstone: kill — real, evidenced decline reaches PREPARE_KILL_REVIEW, and a human decision pauses the product", () => {
  it("declining signups, fully churned revenue, weak activation, and recurring negative feedback drive CRITICAL health and a human-gated pause", async () => {
    const chain = await makeLiveProduct();
    const { agents, product } = chain;
    const now = new Date();

    // Re-score the underlying opportunity with an elevated prior kill risk — a real "we now see this opportunity
    // was already borderline" rescoring event, not a hand-tuned shortcut around the reused M4 scorer.
    await opportunityService.scoreOpportunity({
      opportunityId: product.opportunityId,
      dimensions: ELEVATED_SCORE_DIMENSIONS,
      scoredBy: "test-kill-capstone-rescore",
      killRiskDimensions: ELEVATED_KILL_RISK_DIMENSIONS,
    });

    await seedActivationDefinition(product.id);
    // Prior period: a real signup base, mostly never activating.
    await seedUsageCohort({ productId: product.id, cohortSize: 20, daysAgoSignedUp: 45, activatedFraction: 0.1, retainedFraction: 0, now });
    // Current period: signups have collapsed relative to the prior period — a real, observed DECLINING trajectory.
    await seedUsageCohort({ productId: product.id, cohortSize: 5, daysAgoSignedUp: 10, activatedFraction: 0.1, retainedFraction: 0, now });

    // Three subscriptions that all later cancelled inside the 30-day churn window — real revenue, now real churn.
    await seedRevenueData(
      product.id,
      [
        { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 10 },
        { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 8 },
        { monthlyValueUsd: 40, startedDaysAgo: 60, cancelledDaysAgo: 5 },
      ],
      now,
    );

    // Three independent respondents, all reporting a real recurring negative theme.
    await seedCustomerFeedback(
      product.id,
      [
        { excerpt: "The product stopped solving our problem after the second week.", sentiment: "NEGATIVE" },
        { excerpt: "We cancelled — too many issues and no fix in sight.", sentiment: "NEGATIVE" },
        { excerpt: "Support never resolved our core complaint.", sentiment: "NEGATIVE" },
      ],
      now,
    );

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
    expect(summary.businessHealth!.state).toBe("CRITICAL");
    expect(summary.businessHealth!.risk).toBeGreaterThanOrEqual(0.6);
    expect(summary.businessHealth!.compositeScore).toBeLessThan(0.4);

    expect(summary.ceoRecommendation).not.toBeNull();
    expect(summary.ceoRecommendation!.action).toBe("PREPARE_KILL_REVIEW");

    expect(summary.chairmanReview).not.toBeNull();
    expect(summary.memo).not.toBeNull();
    expect(summary.memo!.recommendation).toBe("PREPARE_KILL_REVIEW");

    // A human APPROVE on a PREPARE_KILL_REVIEW recommendation pauses the product — real, reversible, never automatic.
    const decided = await businessReviewMemoService.recordHumanDecision({ memoId: summary.memo!.id, humanDecision: "APPROVE", humanReason: "Real decline across signups, revenue, and customer sentiment — pause pending a full kill review.", actor: HUMAN_OWNER });
    expect(decided.humanDecision).toBe("APPROVE");
    const finalProduct = await productService.getOrThrow(product.id);
    expect(finalProduct.status).toBe("PAUSED");
  });
});

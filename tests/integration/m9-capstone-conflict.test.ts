import { describe, expect, it } from "vitest";
import { businessHealthRepository } from "../../src/db/repositories/business-health.repository.js";
import { companyRecommendationRepository } from "../../src/db/repositories/company-recommendation.repository.js";
import { NotHumanOwnerError } from "../../src/domain/shared/errors.js";
import { toJsonString } from "../../src/domain/shared/json.js";
import { agentService } from "../../src/services/agent.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { companyRecommendationService } from "../../src/services/company-recommendation.service.js";
import { authActor, HUMAN_OWNER, makeLiveProduct } from "../helpers.js";

/**
 * M9 capstone: the CEO/Chairman conflict path (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §34, M9 brief §22's own named example — "CEO recommends INVEST,
 * Chairman REJECTs it") — STOP -> HUMAN REVIEW is the only terminal
 * state for a real conflict, never an automatic pick of either side.
 * Uses GROW rather than the brief's literal INVEST (buildDevCompanyActionFixture
 * never actually produces INVEST — it has no per-opportunity comparison
 * logic to justify it), but GROW is the same "expansive action" camp
 * (domain/concurrency/concurrency.types.ts's own EXPANSIVE_ACTIONS,
 * company-action.types.ts's own ACTIONS_CONFLICTING_WITH_REJECT), so
 * this exercises the identical governance property the brief names.
 */
describe("M9 capstone: CEO/Chairman conflict — CEO recommends GROW, Chairman REJECTs on a real, independent signal — no execution until a human decides", () => {
  it("a strong composite score with a genuinely unhealthy customer base produces a real, structural disagreement, and nothing auto-proceeds", async () => {
    const chain = await makeLiveProduct();

    // Real, internally-coherent BusinessHealth: revenue/growth/margin/evidence all strong (compositeScore high,
    // state HEALTHY -> WINNERS bucket, exactly what drives the CEO's own GROW rule), but customerHealth
    // deliberately weak — a dimension the CEO's own dev fixture never looks at at all.
    await businessHealthRepository.create({
      productId: chain.product.id,
      productHealth: 0.75,
      customerHealth: 0.3,
      revenueHealth: 0.85,
      growthHealth: 0.85,
      marginHealth: 0.85,
      operationalHealth: 0.8,
      risk: 0.1,
      evidenceConfidence: 0.85,
      compositeScore: 0.75,
      state: "HEALTHY",
      reasons: toJsonString(["[TEST] Strong revenue/growth/margin, but customer health is deliberately weak."]),
    });

    const ceoAgent = await agentService.createAgent({ name: "Conflict CEO", role: "CEO", department: "EXECUTIVE", description: "x", riskLevel: "GREEN", createdBy: HUMAN_OWNER });
    const actor = authActor();

    const ceoOutcome = await ceoReasoningService.recommendCompanyAction({ agentId: ceoAgent.id, startedBy: actor });
    expect(ceoOutcome.status).toBe("COMPLETED");
    if (ceoOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(ceoOutcome.result.recommendation.action).toBe("GROW");

    const chairmanResult = await chairmanService.reviewCompanyAction({ companyRecommendationId: ceoOutcome.result.recommendation.id, reviewedBy: actor });
    expect(chairmanResult.decision.decision).toBe("REJECT");
    expect(chairmanResult.decision.objections.some((o) => o.toLowerCase().includes("customer health"))).toBe(true);

    // resolveCeoChairmanConflict(GROW, REJECT) = CONFLICTED — persisted on the recommendation itself.
    const persisted = await companyRecommendationRepository.getOrThrow(ceoOutcome.result.recommendation.id);
    expect(persisted.conflictResolution).toBe("CONFLICTED");

    // Nothing auto-proceeds and nothing auto-rejects — the recommendation sits genuinely undecided.
    expect(persisted.humanDecision).toBeNull();

    // An AGENT cannot resolve a real conflict any more than an undisputed recommendation (docs/DECISIONS.md's own M9 entry).
    await expect(
      companyRecommendationService.recordHumanDecision({ companyRecommendationId: persisted.id, decision: "APPROVE", reason: null, actor: { actorType: "AGENT", actorId: ceoAgent.id } }),
    ).rejects.toThrow(NotHumanOwnerError);
    const stillUndecided = await companyRecommendationRepository.getOrThrow(persisted.id);
    expect(stillUndecided.humanDecision).toBeNull();

    // Only the Human Owner's real decision resolves it — here, agreeing with the Chairman's objection.
    const decided = await companyRecommendationService.recordHumanDecision({
      companyRecommendationId: persisted.id,
      decision: "REJECT",
      reason: "Agreeing with the Chairman — customer health is too weak to justify growth spend right now.",
      actor: { actorType: "HUMAN", actorId: actor.identityId },
    });
    expect(decided.humanDecision).toBe("REJECT");
    // The conflict verdict itself is never overwritten by the human's decision — it's a permanent record of what happened.
    expect(decided.conflictResolution).toBe("CONFLICTED");
  });
});

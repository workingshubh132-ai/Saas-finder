import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { companyTimelineService } from "../../src/services/company-timeline.service.js";
import { companyRecommendationService } from "../../src/services/company-recommendation.service.js";
import { companyRecommendationRepository } from "../../src/db/repositories/company-recommendation.repository.js";
import { controlPlaneService } from "../../src/services/control-plane.service.js";
import { founderCockpitService } from "../../src/services/founder-cockpit.service.js";
import { identityService } from "../../src/services/identity.service.js";
import { authActor, HUMAN_OWNER } from "../helpers.js";

/**
 * M9 capstone: state is preserved and correctly windowed across
 * cycles, not reset each time the company "wakes up" (docs/M9_ARCHITECTURE_PROPOSAL.md
 * §43-44, M9 brief §31's own "Saturday morning" narrative). Runs one
 * OperatingCycle to COMPLETED, has a human review it (recording a
 * FounderCockpitView), then starts a SECOND cycle and confirms: the
 * Cockpit's "current cycle" correctly moves on to the new one, and the
 * Timeline's own since-last-review window correctly excludes what was
 * already reviewed while still surfacing what's new.
 */
describe("M9 capstone: state preserved and correctly windowed across two real, sequential operating cycles", () => {
  it("a second cycle sees a real prior cycle's consequences, and the timeline's since-last-review window never re-surfaces what was already reviewed", async () => {
    const ceoAgent = await agentService.createAgent({ name: "Weekend CEO", role: "CEO", department: "EXECUTIVE", description: "x", riskLevel: "GREEN", createdBy: HUMAN_OWNER });
    const actor = authActor();
    const identity = await identityService.createIdentity({ type: "HUMAN", label: "Weekend Reviewer", createdBy: { type: "HUMAN", id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId } });

    // Cycle 1: drive it all the way to COMPLETED (empty portfolio -> RESEARCH -> APPROVE, the same deterministic path as the positive capstone).
    const cycle1 = await controlPlaneService.startCycle({ definition: { objective: "Week 1", scope: "company-wide", maxCostUsd: 25, riskLevel: "GREEN", deadline: null, owner: "Founder" }, startedBy: actor });
    // Five calls: CREATED->PLANNING, PLANNING->RESEARCHING, RESEARCHING->ANALYZING, ANALYZING->DECIDING, then DECIDING's own handler runs (creating the CompanyRecommendation) and routes to AWAITING_HUMAN.
    for (let i = 0; i < 5; i++) {
      await controlPlaneService.runNextStage({ cycleId: cycle1.id, actor, ceoAgentId: ceoAgent.id });
    }
    const recs = await companyRecommendationRepository.listForCycle(cycle1.id);
    expect(recs).toHaveLength(1);
    await companyRecommendationService.recordHumanDecision({ companyRecommendationId: recs[0]!.id, decision: "APPROVE", reason: "Week 1 sign-off.", actor: { actorType: "HUMAN", actorId: actor.identityId } });
    await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle1.id, actor, decisionSummary: "Approved." });
    // Resumes at DECIDING (2nd pass) — four calls: DECIDING(detects already-decided)->EXECUTING, EXECUTING->OBSERVING, OBSERVING->LEARNING, LEARNING->COMPLETED.
    for (let i = 0; i < 4; i++) {
      await controlPlaneService.runNextStage({ cycleId: cycle1.id, actor, ceoAgentId: ceoAgent.id });
    }
    const completedCycle1 = await controlPlaneService.getCycle(cycle1.id);
    expect(completedCycle1.status).toBe("COMPLETED");

    // The Saturday-morning review: the founder opens the Cockpit, recording a real FounderCockpitView.
    const weekendCockpit = await founderCockpitService.getCockpit(identity.identity.id);
    expect(weekendCockpit.currentCycleStage).toBeNull(); // Cycle 1 is COMPLETED — no active cycle right now.
    const reviewedAt = new Date();

    // Week 2 starts: a second, distinct OperatingCycle.
    const cycle2 = await controlPlaneService.startCycle({ definition: { objective: "Week 2", scope: "company-wide", maxCostUsd: 25, riskLevel: "GREEN", deadline: null, owner: "Founder" }, startedBy: actor });
    await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor, ceoAgentId: ceoAgent.id }); // -> PLANNING

    // The Cockpit now reports the NEW cycle as current — stale cycle-1 state is never carried forward as "current."
    const secondCockpit = await founderCockpitService.getCockpit(identity.identity.id);
    expect(secondCockpit.currentCycleStage).toBe("PLANNING");

    // Since-last-review: everything from cycle 1 (already reviewed at the weekend) is excluded; cycle 2's own new event is included.
    const sinceReview = await companyTimelineService.getTimeline(reviewedAt);
    expect(sinceReview.some((e) => e.type === "OPERATING_CYCLE_STAGE_ADVANCED" && e.payload.cycleId === cycle2.id)).toBe(true);
    expect(sinceReview.some((e) => e.payload.cycleId === cycle1.id)).toBe(false);

    // The unfiltered, full timeline still has both — nothing was ever deleted, only windowed.
    const fullTimeline = await companyTimelineService.getTimeline();
    expect(fullTimeline.some((e) => e.payload.cycleId === cycle1.id)).toBe(true);
    expect(fullTimeline.some((e) => e.payload.cycleId === cycle2.id)).toBe(true);
  });
});

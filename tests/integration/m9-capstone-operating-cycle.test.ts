import { describe, expect, it } from "vitest";
import { companyRecommendationRepository } from "../../src/db/repositories/company-recommendation.repository.js";
import { agentService } from "../../src/services/agent.service.js";
import { companyRecommendationService } from "../../src/services/company-recommendation.service.js";
import { controlPlaneService } from "../../src/services/control-plane.service.js";
import { authActor, HUMAN_OWNER } from "../helpers.js";

/**
 * M9 capstone: a full company-level OperatingCycle, positive path
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §15-17) — CREATED through COMPLETED,
 * driven entirely by controlPlaneService.runNextStage, with a REAL human
 * decision recorded in between (never skipped, never fabricated). This
 * is also the regression test for a real bug this build caught while
 * writing tests/unit/m9-operating-cycle.test.ts: DECIDING's own
 * CycleStageEvent is deliberately left open when it routes to
 * AWAITING_HUMAN (so a resume re-enters DECIDING itself, per
 * resolveResumeStage's own history-based rule) — but DECIDING's handler
 * used to unconditionally re-request human review on every re-entry,
 * meaning the cycle could NEVER reach EXECUTING no matter how many
 * times a human "approved." Fixed by having runNextStage's DECIDING
 * case check for an already-decided CompanyRecommendation first, and if
 * found, ask schedulerService.advanceStage for the EXECUTING branch
 * explicitly (array-adjacency alone can only ever produce AWAITING_HUMAN
 * from DECIDING).
 */
describe("M9 capstone: positive full operating cycle — CREATED through COMPLETED, one real human decision, no fabricated shortcuts", () => {
  it("advances through every real stage, stops for the Human Owner exactly once, and reaches COMPLETED only after a real decision is recorded", async () => {
    const ceoAgent = await agentService.createAgent({ name: "Capstone CEO", role: "CEO", department: "EXECUTIVE", description: "x", riskLevel: "GREEN", createdBy: HUMAN_OWNER });
    const actor = authActor();

    const cycle = await controlPlaneService.startCycle({
      definition: { objective: "Decide the company's next move", scope: "company-wide", maxCostUsd: 25, riskLevel: "GREEN", deadline: null, owner: "Founder" },
      startedBy: actor,
    });
    expect(cycle.stage).toBe("CREATED");
    expect(cycle.status).toBe("RUNNING");

    // CREATED -> PLANNING -> RESEARCHING -> ANALYZING -> DECIDING, each one real stage's worth of work.
    let current = cycle;
    for (const expectedNextStage of ["PLANNING", "RESEARCHING", "ANALYZING", "DECIDING"]) {
      current = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id });
      expect(current.stage).toBe(expectedNextStage);
      expect(current.status).toBe("RUNNING");
    }

    // DECIDING's first pass: real CEO reasoning + real Chairman review, then a mandatory stop for the human —
    // never an auto-proceed, regardless of what the CEO/Chairman concluded (Constitution §8).
    current = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id });
    expect(current.stage).toBe("AWAITING_HUMAN");
    expect(current.status).toBe("AWAITING_HUMAN");

    // Nothing has executed — the cycle stopped, not skipped, and the recommendation is genuinely undecided.
    const undecided = await controlPlaneService.getPortfolio();
    expect(undecided).toBeDefined(); // Portfolio read still works mid-cycle — no partial/corrupt state.

    const recommendations = await companyRecommendationRepository.listForCycle(cycle.id);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.humanDecision).toBeNull();

    // Calling runNextStage again while genuinely AWAITING_HUMAN is refused — resumeFromAwaitingHuman is the only way forward.
    await expect(controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id })).rejects.toThrow();

    // The Human Owner records a REAL decision on the recommendation itself — an AGENT could never do this (see tests/integration/m9-security.test.ts).
    const decided = await companyRecommendationService.recordHumanDecision({ companyRecommendationId: recommendations[0]!.id, decision: "APPROVE", reason: "Reasonable given an empty portfolio.", actor: { actorType: "HUMAN", actorId: actor.identityId } });
    expect(decided.humanDecision).toBe("APPROVE");

    // Unblocks the cycle machinery itself — a separate, deliberate second step from recording the decision above.
    current = (await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle.id, actor, decisionSummary: "Human approved the CEO's RESEARCH recommendation." })).cycle;
    expect(current.status).toBe("RUNNING");
    // Re-enters DECIDING itself (never skips ahead) — the exact re-entry point the bug above is about.
    expect(current.stage).toBe("DECIDING");

    // DECIDING's second pass: detects the already-recorded decision and proceeds straight to EXECUTING —
    // never creates a duplicate CompanyRecommendation, never re-requests human review.
    current = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id });
    expect(current.stage).toBe("EXECUTING");
    expect(current.status).toBe("RUNNING");

    const recommendationsAfterExecuting = await companyRecommendationRepository.listForCycle(cycle.id);
    expect(recommendationsAfterExecuting).toHaveLength(1); // Still exactly one — no duplicate created on re-entry.

    // EXECUTING -> OBSERVING -> LEARNING -> COMPLETED, each a real bookkeeping pass (M9 adds zero new execution paths).
    for (const expectedNextStage of ["OBSERVING", "LEARNING", "COMPLETED"]) {
      current = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id });
      expect(current.stage).toBe(expectedNextStage);
    }
    expect(current.status).toBe("COMPLETED");
    expect(current.completedAt).not.toBeNull();

    // A completed cycle is inert — runNextStage on it is a safe, idempotent no-op, never an error or a re-run.
    const afterCompletion = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor, ceoAgentId: ceoAgent.id });
    expect(afterCompletion.stage).toBe("COMPLETED");
    expect(afterCompletion.status).toBe("COMPLETED");

    const stageHistory = await controlPlaneService.getCycleStageHistory(cycle.id);
    // Ten real stage events: the nine linear stages plus the one AWAITING_HUMAN detour (DECIDING's own
    // pre-decision event stays open forever — a real, permanent record that this attempt needed human review).
    const stageNames = stageHistory.map((e) => e.stage);
    expect(stageNames).toContain("AWAITING_HUMAN");
    expect(stageNames.filter((s) => s === "DECIDING")).toHaveLength(2); // The original (left open) + the redo.
  });
});

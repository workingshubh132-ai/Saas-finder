import { describe, expect, it } from "vitest";
import { approvalService } from "../../src/services/approval.service.js";
import { experimentAnalystService } from "../../src/services/experiment-analyst.service.js";
import { growthAnalystService } from "../../src/services/growth-analyst.service.js";
import { growthExperimentExecutionService } from "../../src/services/growth-experiment-execution.service.js";
import { growthExperimentService } from "../../src/services/growth-experiment.service.js";
import { authActor, HUMAN_OWNER, makeLiveProduct } from "../helpers.js";

/**
 * The experiment M8 capstone (docs/M8_ARCHITECTURE_PROPOSAL.md §1,
 * §14, §25-26, M8 brief §55): the full growth-experiment lifecycle —
 * an agent PROPOSES a controlled experiment targeting a real,
 * under-evidenced claim, a human APPROVES it (mirroring M7's own
 * PLAN/APPROVE/EXECUTE mechanism exactly, per §26's explicit reuse
 * instruction), a human separately starts it running, its real
 * observed outcome is recorded with a deterministic confidence level
 * (never a fabricated p-value), and that outcome becomes NEW DATA the
 * Growth Analyst can read on its very next run — closing the loop the
 * M8 brief's mission statement describes end to end.
 */
describe("M8 capstone: experiment — propose, approve, run, and complete a real growth experiment; its result becomes new input", () => {
  it("DRAFT -> ANALYZED -> AWAITING_APPROVAL -> APPROVED -> RUNNING -> COMPLETED, gated by a real human approval and a real human start", async () => {
    const chain = await makeLiveProduct();
    const { agents, product } = chain;

    const proposeOutcome = await experimentAnalystService.run({
      agentId: agents.experimentAnalystAgent.id,
      productId: product.id,
      targetMetricType: "CONVERSION_RATE",
      startedBy: authActor(),
    });
    expect(proposeOutcome.status).toBe("COMPLETED");
    if (proposeOutcome.status !== "COMPLETED") throw new Error("unreachable");
    const { growthExperiment: proposed, targetClaim } = proposeOutcome.result;
    expect(proposed.status).toBe("ANALYZED");
    expect(proposed.claimId).toBe(targetClaim.id);

    // No self-execution: proposing an experiment never itself runs it — it still requires a real approval gate.
    const approvalRequest = await growthExperimentService.requestApproval({ growthExperimentId: proposed.id, requestedByAgentId: agents.experimentAnalystAgent.id });
    expect(approvalRequest.resourceType).toBe("GROWTH_EXPERIMENT");
    expect(approvalRequest.resourceId).toBe(proposed.id);
    const afterRequest = await growthExperimentService.getOrThrow(proposed.id);
    expect(afterRequest.status).toBe("AWAITING_APPROVAL");

    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    const approved = await growthExperimentService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    expect(approved.status).toBe("APPROVED");

    // A second, distinct human-gated step actually starts the clock — approval alone never runs anything.
    const running = await growthExperimentExecutionService.approveToRun({ growthExperimentId: approved.id, actor: HUMAN_OWNER });
    expect(running.status).toBe("RUNNING");

    // A genuinely large sample (>= MIN_EXPERIMENT_SAMPLE) with a >= 15% lift — deterministic HIGH_CONFIDENCE, never an invented p-value.
    const { experiment: completed, result } = await growthExperimentExecutionService.completeExperiment({
      growthExperimentId: running.id,
      baselineValue: 100,
      experimentValue: 120,
      sampleSize: 50,
      limitations: "Single-cohort dev-fixture observation window; no holdout randomization tooling in this milestone.",
    });
    expect(completed.status).toBe("COMPLETED");
    expect(result.observedChangePct).toBeCloseTo(0.2, 5);
    expect(result.confidence).toBe("HIGH_CONFIDENCE");
    expect(result.decision).toMatch(/^POSITIVE/);

    // NEW DATA: the very next Growth Analyst run reads this real, just-completed result — closing the loop.
    const growthOutcome = await growthAnalystService.run({ agentId: agents.growthAnalystAgent.id, productId: product.id, startedBy: authActor() });
    expect(growthOutcome.status).toBe("COMPLETED");
    if (growthOutcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(growthOutcome.result.summary.completedExperimentResults.map((r) => r.id)).toContain(result.id);
    expect(growthOutcome.result.output.promisingChannel).not.toBeNull();
  });
});

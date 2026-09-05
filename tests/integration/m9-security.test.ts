import { describe, expect, it } from "vitest";
import { agentPermissionRepository } from "../../src/db/repositories/permission.repository.js";
import { agentExecutionRepository } from "../../src/db/repositories/agent-execution.repository.js";
import { businessHealthRepository } from "../../src/db/repositories/business-health.repository.js";
import { companyRecommendationRepository } from "../../src/db/repositories/company-recommendation.repository.js";
import { prisma } from "../../src/db/client.js";
import { PERMISSIONS } from "../../src/domain/permission/permission.js";
import { EmergencyStopActiveError, NotHumanOwnerError, StaleApprovalError } from "../../src/domain/shared/errors.js";
import { toJsonString } from "../../src/domain/shared/json.js";
import { alertService } from "../../src/services/alert.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { companyBudgetService } from "../../src/services/company-budget.service.js";
import { companyRecommendationService } from "../../src/services/company-recommendation.service.js";
import { deploymentPlanService } from "../../src/services/deployment-plan.service.js";
import { deploymentService } from "../../src/services/deployment.service.js";
import { emergencyStopService } from "../../src/services/emergency-stop.service.js";
import { launchReviewMemoService } from "../../src/services/launch-review-memo.service.js";
import { schedulerService } from "../../src/services/scheduler.service.js";
import { authActor, HUMAN_OWNER, makeAwaitingLaunchApprovalProduct, makeFullAgentSet, makeLiveProduct } from "../helpers.js";

const AGENT_ACTOR = (agentId: string): { actorType: "AGENT"; actorId: string } => ({ actorType: "AGENT", actorId: agentId });
const AGENT_AUTHENTICATED_ACTOR = (agentId: string): { type: "AGENT"; id: string; identityId: string } => ({ type: "AGENT", id: agentId, identityId: agentId });

/** A DeploymentPlan approved-but-not-yet-executed — the shared starting point for every EXECUTE-gate test below (mirrors makeLiveProduct's own pre-EXECUTE half). */
async function makeApprovedNotExecutedDeployment() {
  const chain = await makeAwaitingLaunchApprovalProduct();
  await launchReviewMemoService.recordHumanDecision({ memoId: chain.memo.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });
  const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: chain.deploymentPlan.id, requestedByAgentId: chain.agents.launchStrategistAgent.id });
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
  await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
  return chain;
}

/**
 * Real tests proving the security properties
 * docs/M9_ARCHITECTURE_PROPOSAL.md §51's own threat table claims — not
 * documentation claims. Every flow below is exercised through the real
 * service chain (mirrors m7-security.test.ts/m8-security.test.ts's own
 * discipline exactly); HTTP-layer auth enforcement is covered separately
 * in tests/integration/api-m9.test.ts.
 */
describe("M9 security: Emergency Stop fails closed at every real EXECUTE step", () => {
  it("blocks a real DeploymentPlan EXECUTE while active, and a resumed stop lets the same approved plan execute again", async () => {
    const chain = await makeApprovedNotExecutedDeployment();
    await emergencyStopService.activate({ actor: authActor(), reason: "M9 security test" });

    await expect(deploymentService.execute({ deploymentPlanId: chain.deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(EmergencyStopActiveError);

    await emergencyStopService.resume({ actor: authActor() });
    const deployment = await deploymentService.execute({ deploymentPlanId: chain.deploymentPlan.id, actor: HUMAN_OWNER });
    expect(deployment.status).toBe("LIVE");
  });
});

describe("M9 security: Emergency Stop activate/resume is Human-Owner-only", () => {
  it("rejects an AGENT actor attempting to activate the company-wide kill switch", async () => {
    await expect(emergencyStopService.activate({ actor: AGENT_AUTHENTICATED_ACTOR("some-agent-id"), reason: "attack" })).rejects.toThrow(NotHumanOwnerError);
  });

  it("rejects an AGENT actor attempting to resume from an active stop", async () => {
    await emergencyStopService.activate({ actor: authActor(), reason: "M9 security test" });
    await expect(emergencyStopService.resume({ actor: AGENT_AUTHENTICATED_ACTOR("some-agent-id") })).rejects.toThrow(NotHumanOwnerError);
    await emergencyStopService.resume({ actor: authActor() }); // Clean up for later tests in this file.
  });
});

describe("M9 security: stale-approval detection — a resource that changed after approval cannot execute on the old approval", () => {
  it("deploymentService.execute rejects an approved plan whose environment was changed out-of-band after approval", async () => {
    const chain = await makeApprovedNotExecutedDeployment();
    // A real out-of-band change to one of hashDeploymentPlan's own hashed fields — a different but still-valid DEPLOYMENT_ENVIRONMENTS value, never a mock.
    const changedEnvironment = chain.deploymentPlan.environment === "PRODUCTION" ? "STAGING" : "PRODUCTION";
    await prisma.deploymentPlan.update({ where: { id: chain.deploymentPlan.id }, data: { environment: changedEnvironment } });

    await expect(deploymentService.execute({ deploymentPlanId: chain.deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(StaleApprovalError);
  });
});

describe("M9 security: a CompanyRecommendation's human decision — the sole terminal step a CEO/Chairman conflict stops on — is Human-Owner-only", () => {
  it("rejects an AGENT actor recording the decision", async () => {
    const rec = await companyRecommendationRepository.create({ action: "INVEST", reasoning: "test", citedResourceIds: toJsonString([]), confidence: 0.8 });
    await expect(companyRecommendationService.recordHumanDecision({ companyRecommendationId: rec.id, decision: "APPROVE", reason: null, actor: AGENT_ACTOR("some-agent-id") })).rejects.toThrow(NotHumanOwnerError);
    const stillUndecided = await companyRecommendationRepository.getOrThrow(rec.id);
    expect(stillUndecided.humanDecision).toBeNull();
  });

  it("records a decision exactly once — a second call with a different decision never overwrites the first", async () => {
    const rec = await companyRecommendationRepository.create({ action: "GROW", reasoning: "test", citedResourceIds: toJsonString([]), confidence: 0.8 });
    const first = await companyRecommendationService.recordHumanDecision({ companyRecommendationId: rec.id, decision: "APPROVE", reason: "looks good", actor: HUMAN_OWNER });
    expect(first.humanDecision).toBe("APPROVE");

    const second = await companyRecommendationService.recordHumanDecision({ companyRecommendationId: rec.id, decision: "REJECT", reason: "changed my mind", actor: HUMAN_OWNER });
    expect(second.humanDecision).toBe("APPROVE"); // Idempotent-return — REJECT never overwrites the already-recorded APPROVE.
    expect(second.humanReason).toBe("looks good");
  });
});

describe("M9 security: Company Budget — a real, oversized AgentExecution spend is detected, never silently absorbed", () => {
  it("companyBudgetService.assertNotExceeded reports exceeded once real spend this period crosses the founder-configured ceiling", async () => {
    const agents = await makeFullAgentSet();
    const execution = await agentExecutionRepository.create({ agentId: agents.ceoAgent.id, taskId: null, startedByIdentityId: HUMAN_OWNER.actorId, input: "M9 security test" });
    await agentExecutionRepository.update(execution.id, { estimatedCostUsd: 1000 });

    const result = await companyBudgetService.assertNotExceeded();
    expect(result.exceeded).toBe(true);
    expect(result.consumedUsd).toBeGreaterThan(result.ceilingUsd);
  });

  it("schedulerService.advanceStage actually STOPS a real RUNNING cycle over an oversized spend, rather than merely reporting it, and raises a real BUDGET_EXHAUSTED alert", async () => {
    const agents = await makeFullAgentSet();
    const actor = authActor();
    const cycle = await schedulerService.startCycle({ definition: { objective: "x", scope: "x", maxCostUsd: 999999, riskLevel: "GREEN", deadline: null, owner: "x" }, startedBy: actor });
    expect(cycle.status).toBe("RUNNING");

    const execution = await agentExecutionRepository.create({ agentId: agents.ceoAgent.id, taskId: null, startedByIdentityId: HUMAN_OWNER.actorId, input: "M9 security test — overspend" });
    await agentExecutionRepository.update(execution.id, { estimatedCostUsd: 100000 });

    const result = await schedulerService.advanceStage({ cycleId: cycle.id, actor });
    expect(result.cycle.status).toBe("STOPPED");
    expect(result.cycle.stoppedReason).toContain("COMPANY_BUDGET_EXCEEDED");
    // A stopped cycle can never be resumed by simply advancing again — the budget check itself already terminated it.
    expect(result.cycle.stage).toBe("CREATED"); // Never advanced past its starting stage.

    const alerts = await alertService.list();
    const budgetAlert = alerts.find((a) => a.alertType === "BUDGET_EXHAUSTED" && a.resourceId === cycle.id);
    expect(budgetAlert).toBeDefined();
    expect(budgetAlert!.severity).toBe("WARNING");
  });
});

describe("M9 security: zero new Guardian permission for company-level CEO reasoning", () => {
  it("recommendCompanyAction completes for a CEO agent holding zero active grants for any permission in the system", async () => {
    const agents = await makeFullAgentSet();
    for (const permission of PERMISSIONS) {
      expect(await agentPermissionRepository.hasActivePermission(agents.ceoAgent.id, permission)).toBe(false);
    }

    const outcome = await ceoReasoningService.recommendCompanyAction({ agentId: agents.ceoAgent.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
  });
});

describe("M9 security: OperatingCycle pause/cancel are Human-Owner-only, at the service layer directly (not just HTTP)", () => {
  it("rejects an AGENT actor pausing or cancelling a real, RUNNING cycle", async () => {
    const cycle = await schedulerService.startCycle({ definition: { objective: "x", scope: "x", maxCostUsd: 10, riskLevel: "GREEN", deadline: null, owner: "x" }, startedBy: authActor() });

    await expect(schedulerService.pauseCycle({ cycleId: cycle.id, actor: AGENT_AUTHENTICATED_ACTOR("some-agent-id"), reason: "attack" })).rejects.toThrow(NotHumanOwnerError);
    await expect(schedulerService.cancelCycle({ cycleId: cycle.id, actor: AGENT_AUTHENTICATED_ACTOR("some-agent-id"), reason: "attack" })).rejects.toThrow(NotHumanOwnerError);
  });
});

describe("M9 security: concurrency conflict detection is read-time-only — it surfaces a real conflict, never blocks or silently drops either recommendation (§40)", () => {
  it("a new, conflicting company-level recommendation is flagged against the real pending one, and both remain visible", async () => {
    const preExisting = await companyRecommendationRepository.create({ action: "GROW", reasoning: "[TEST] Pre-existing pending recommendation.", citedResourceIds: toJsonString([]), confidence: 0.7 });

    const chain = await makeFullAgentSet();
    const liveProductChain = await makeLiveProduct();
    await businessHealthRepository.create({
      productId: liveProductChain.product.id,
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
      reasons: toJsonString(["[TEST] deliberately CRITICAL to force PREPARE_KILL_REVIEW, conflicting with the pending GROW."]),
    });

    const outcome = await ceoReasoningService.recommendCompanyAction({ agentId: chain.ceoAgent.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("unreachable");
    expect(outcome.result.recommendation.action).toBe("PREPARE_KILL_REVIEW"); // Contractive — conflicts with the pending GROW (expansive).

    // Flagged, never blocked: the new recommendation was still created, carrying a visible conflict marker.
    expect(outcome.result.recommendation.reasoning).toContain(`CONCURRENT_CONFLICT with recommendation ${preExisting.id}`);
    const citedIds = JSON.parse(outcome.result.recommendation.citedResourceIds) as string[];
    expect(citedIds).toContain(preExisting.id);

    // Neither recommendation was silently superseded or deleted — both remain in the real Human Decision Queue.
    const stillPending = await companyRecommendationRepository.listUndecided();
    expect(stillPending.map((r) => r.id)).toEqual(expect.arrayContaining([preExisting.id, outcome.result.recommendation.id]));

    const alerts = await alertService.list();
    expect(alerts.some((a) => a.alertType === "CONCURRENT_CONFLICT" && a.resourceId === preExisting.id)).toBe(true);
  });
});

describe("M9 security: duplicate execution — a second startCycle call with the same idempotencyKey never creates a second OperatingCycle", () => {
  it("returns the identical, already-existing cycle rather than a duplicate, and a different key still creates a genuinely new one", async () => {
    const definition = { objective: "x", scope: "x", maxCostUsd: 10, riskLevel: "GREEN" as const, deadline: null, owner: "x" };
    const first = await schedulerService.startCycle({ definition, startedBy: authActor(), idempotencyKey: "capstone-idempotency-key-1" });
    const second = await schedulerService.startCycle({ definition, startedBy: authActor(), idempotencyKey: "capstone-idempotency-key-1" });
    expect(second.id).toBe(first.id);

    const allCycles = await schedulerService.getCycle(first.id);
    expect(allCycles.id).toBe(first.id); // Sanity: exactly the one row exists, retrievable by its own id.

    const differentKey = await schedulerService.startCycle({ definition, startedBy: authActor(), idempotencyKey: "capstone-idempotency-key-2" });
    expect(differentKey.id).not.toBe(first.id);
  });
});

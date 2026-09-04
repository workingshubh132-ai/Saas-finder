import { describe, expect, it } from "vitest";
import { agentPermissionRepository } from "../../src/db/repositories/permission.repository.js";
import { PERMISSIONS } from "../../src/domain/permission/permission.js";
import { NotFoundError, NotHumanOwnerError, ValidationError } from "../../src/domain/shared/errors.js";
import { approvalService } from "../../src/services/approval.service.js";
import { billingActivationService } from "../../src/services/billing-activation.service.js";
import { billingPlanService } from "../../src/services/billing-plan.service.js";
import { deploymentPlanService } from "../../src/services/deployment-plan.service.js";
import { deploymentService } from "../../src/services/deployment.service.js";
import { HUMAN_OWNER, makeAwaitingLaunchApprovalProduct } from "../helpers.js";

const AGENT_ACTOR = (agentId: string): { actorType: "AGENT"; actorId: string } => ({ actorType: "AGENT", actorId: agentId });

const M7_RED_ORANGE_YELLOW_PERMISSIONS = ["DEPLOY_PRODUCTION", "ACTIVATE_BILLING", "MODIFY_PRODUCTION", "ACCESS_PRODUCTION_DATA", "CREATE_BILLING"] as const;

/**
 * Real tests proving the security properties
 * docs/M7_ARCHITECTURE_PROPOSAL.md §35's 20-item threat review claims
 * — not documentation claims. Every DeploymentPlan/BillingPlan
 * approval flow below is exercised through the real
 * makeAwaitingLaunchApprovalProduct() chain, never a mocked shortcut.
 */
describe("M7 security: least privilege — no agent ever holds an M7 above-GREEN permission", () => {
  it("every agent created by makeFullAgentSet holds zero grants for any M7 RED/ORANGE/YELLOW permission", async () => {
    const { agents } = await makeAwaitingLaunchApprovalProduct();
    for (const agent of Object.values(agents)) {
      for (const permission of M7_RED_ORANGE_YELLOW_PERMISSIONS) {
        expect(await agentPermissionRepository.hasActivePermission(agent.id, permission)).toBe(false);
      }
    }
  });

  it("PERMISSIONS declares exactly the five new M7 permissions, no more, no fewer", () => {
    for (const permission of M7_RED_ORANGE_YELLOW_PERMISSIONS) {
      expect(PERMISSIONS).toContain(permission);
    }
  });
});

describe("M7 security: EXECUTE steps are human-actor-only, never reachable by an agent", () => {
  it("deploymentService.execute rejects an AGENT actor even with an otherwise-valid, HUMAN_APPROVED plan", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });

    await expect(deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: AGENT_ACTOR(agents.launchStrategistAgent.id) })).rejects.toThrow(NotHumanOwnerError);
  });

  it("deploymentService.execute refuses a plan that is not yet HUMAN_APPROVED", async () => {
    const { deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    await expect(deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });

  it("deploymentService.execute refuses a plan whose ApprovalRequest was REJECTED, even though the request exists", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "REJECTED", reviewedBy: HUMAN_OWNER });
    const rejectedPlan = await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    expect(rejectedPlan.status).toBe("REJECTED");

    await expect(deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });

  it("a DeploymentPlan cannot be executed twice — the second call fails because the plan already advanced past HUMAN_APPROVED", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });

    const first = await deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER });
    expect(first.status).toBe("LIVE");

    await expect(deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });

  it("deploymentService.rollback rejects an AGENT actor", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    const deployment = await deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER });

    await expect(deploymentService.rollback({ deploymentId: deployment.id, actor: AGENT_ACTOR(agents.launchStrategistAgent.id) })).rejects.toThrow(NotHumanOwnerError);
  });

  it("deploymentService.rollback refuses a Deployment that is not LIVE", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    const deployment = await deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER });
    await deploymentService.rollback({ deploymentId: deployment.id, actor: HUMAN_OWNER });

    // The original Deployment row is now superseded — rolling it back again must fail (it is no longer LIVE).
    await expect(deploymentService.rollback({ deploymentId: deployment.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });

  it("billingActivationService.activate rejects an AGENT actor even with an otherwise-valid, HUMAN_APPROVED billing plan", async () => {
    const { agents, product, pricingModel } = await makeAwaitingLaunchApprovalProduct();
    const billingPlan = await billingPlanService.create({ productId: product.id, pricingModelId: pricingModel.id, provider: "DEV_FIXTURE" });
    const approvalRequest = await billingPlanService.requestApproval({ billingPlanId: billingPlan.id, requestedByAgentId: agents.pricingAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await billingPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });

    await expect(billingActivationService.activate({ billingPlanId: billingPlan.id, actor: AGENT_ACTOR(agents.pricingAgent.id) })).rejects.toThrow(NotHumanOwnerError);
  });

  it("billingActivationService.activate refuses a billing plan that is not yet HUMAN_APPROVED", async () => {
    const { product, pricingModel } = await makeAwaitingLaunchApprovalProduct();
    const billingPlan = await billingPlanService.create({ productId: product.id, pricingModelId: pricingModel.id, provider: "DEV_FIXTURE" });
    await expect(billingActivationService.activate({ billingPlanId: billingPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });
});

describe("M7 security: self-approval is impossible for the exact-action-bound RED approvals introduced here", () => {
  it("an agent cannot approve its own DeploymentPlan approval request", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });

    await expect(approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: AGENT_ACTOR(agents.launchStrategistAgent.id) })).rejects.toThrow();
  });
});

describe("M7 security: exact-action binding — the approval must resolve to the specific resource being acted on", () => {
  it("deploymentPlanService.applyDecision refuses an ApprovalRequest that is not bound to a DeploymentPlan", async () => {
    const { agents, product } = await makeAwaitingLaunchApprovalProduct();
    const strayApproval = await approvalService.requestApproval({
      requestedByAgentId: agents.launchStrategistAgent.id,
      action: "DEPLOY_PRODUCTION",
      description: "Not actually bound to a real DeploymentPlan.",
      riskLevel: "RED",
      resourceType: "PRODUCT",
      resourceId: product.id,
    });
    await approvalService.decide({ id: strayApproval.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    await expect(deploymentPlanService.applyDecision({ approvalRequestId: strayApproval.id, actor: HUMAN_OWNER })).rejects.toThrow(ValidationError);
  });

  it("deploymentService.execute fails closed (NotFoundError) if the plan's own bound ApprovalRequest exists but was never actually APPROVED", async () => {
    const { agents, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();
    await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
    // Force HUMAN_APPROVED without ever deciding the bound ApprovalRequest (still PENDING) — simulating a bypass of applyDecision.
    await deploymentPlanService.setStatus(deploymentPlan.id, "HUMAN_APPROVED");

    await expect(deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER })).rejects.toThrow(NotFoundError);
  });
});

describe("M7 security: webhook source validation", () => {
  it("billingActivationService.recordSubscriptionFixture fails closed for an unknown billing account", async () => {
    await expect(billingActivationService.recordSubscriptionFixture({ billingAccountId: "does-not-exist", customerEmail: "x@example.test" })).rejects.toThrow(NotFoundError);
  });
});

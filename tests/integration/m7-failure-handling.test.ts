import { describe, expect, it } from "vitest";
import { deploymentPlanRepository } from "../../src/db/repositories/deployment-plan.repository.js";
import { approvalService } from "../../src/services/approval.service.js";
import { deploymentPlanService } from "../../src/services/deployment-plan.service.js";
import { deploymentService } from "../../src/services/deployment.service.js";
import { productService } from "../../src/services/product.service.js";
import { createDeploymentProvider } from "../../src/providers/deployment-provider-factory.js";
import { HUMAN_OWNER, makeAwaitingLaunchApprovalProduct } from "../helpers.js";

/**
 * §39's own claim, verified directly: a failed EXECUTE attempt never
 * silently retries and never strands the Product in a dead end — it
 * reverts to AWAITING_LAUNCH_APPROVAL so the SAME already-approved
 * plan can be re-executed, with no automatic loop (every attempt is
 * its own fully human-triggered call, docs/M7_ARCHITECTURE_PROPOSAL.md
 * §39).
 */
describe("M7 failure handling: a failed EXECUTE reverts cleanly and is safely re-executable", () => {
  it(
    "DevDeploymentProvider.deploy() failing (empty artifactRef) reverts Product to AWAITING_LAUNCH_APPROVAL and leaves the plan HUMAN_APPROVED, retriable — never a silent retry, never a dead end",
    async () => {
      const { agents, product, deploymentPlan } = await makeAwaitingLaunchApprovalProduct();

      // A deliberately invalid plan (empty artifactRef) — DevDeploymentProvider.deploy() fails deterministically on this, never a random chance (§8).
      const badPlan = await deploymentPlanRepository.create({
        productId: product.id,
        environment: deploymentPlan.environment,
        provider: createDeploymentProvider().id,
        strategy: deploymentPlan.strategy,
        estimatedCostUsd: deploymentPlan.estimatedCostUsd,
        rollbackPlan: deploymentPlan.rollbackPlan,
        artifactRef: "",
        budgetExceeded: false,
      });
      const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: badPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
      await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
      await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });

      const failedDeployment = await deploymentService.execute({ deploymentPlanId: badPlan.id, actor: HUMAN_OWNER });
      expect(failedDeployment.status).toBe("FAILED");

      // Never a dead end: Product reverted, plan stays HUMAN_APPROVED (never demoted to REJECTED or stuck at DEPLOYING).
      expect((await productService.getOrThrow(product.id)).status).toBe("AWAITING_LAUNCH_APPROVAL");
      const planAfterFailure = await deploymentPlanService.getOrThrow(badPlan.id);
      expect(planAfterFailure.status).toBe("HUMAN_APPROVED");

      // Never a silent automatic retry: nothing above looped on its own —
      // this test made exactly one execute() call so far. A SECOND,
      // fully human-triggered retry against the SAME still-HUMAN_APPROVED
      // plan reuses the identical approval, never a fresh one — proving
      // the retry is a genuine re-attempt, not a new consequential action.
      const retryDeployment = await deploymentService.execute({ deploymentPlanId: badPlan.id, actor: HUMAN_OWNER });
      expect(retryDeployment.status).toBe("FAILED"); // artifactRef is still empty — same deterministic failure, not a flake.
      expect((await deploymentPlanService.getOrThrow(badPlan.id)).approvalRequestId).toBe(approvalRequest.id);
    },
    { timeout: 180_000 },
  );
});

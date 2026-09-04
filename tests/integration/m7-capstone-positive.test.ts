import { describe, expect, it } from "vitest";
import { businessMetricRepository } from "../../src/db/repositories/business-metric.repository.js";
import { approvalService } from "../../src/services/approval.service.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { deploymentPlanService } from "../../src/services/deployment-plan.service.js";
import { deploymentService } from "../../src/services/deployment.service.js";
import { launchReviewMemoService } from "../../src/services/launch-review-memo.service.js";
import { monitoringService } from "../../src/services/monitoring.service.js";
import { productService } from "../../src/services/product.service.js";
import { authActor, HUMAN_OWNER, makeAwaitingLaunchApprovalProduct } from "../helpers.js";

/**
 * M7 mandatory capstone #1: the positive end-to-end path
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §40.1) — a READY_FOR_DEPLOYMENT
 * Product through Launch Strategist/Pricing/GTM (PLAN), a compiled
 * LaunchReviewMemo, a real human APPROVE, a real (exact-action-bound)
 * DeploymentPlan approval, a real EXECUTE against the DEV_FIXTURE
 * DeploymentProvider, LIVE status, a real on-demand health check, real
 * BusinessMetric rows (both OBSERVED and ESTIMATED, correctly
 * labeled), and a real follow-up CEO operating recommendation. No
 * assertion below claims real revenue, real customers, or real
 * uptime — every fact checked is a real fixture, correctly labeled.
 */
describe("M7 capstone: positive path", () => {
  it(
    "a genuinely clean launch reaches LIVE through PLAN -> APPROVE -> EXECUTE, with correctly-labeled business metrics and a real operating recommendation",
    async () => {
      const chain = await makeAwaitingLaunchApprovalProduct();
      const { agents, product, deploymentPlan, memo } = chain;

      // PLAN facts are real and grounded — never a blank/empty plan.
      expect(deploymentPlan.environment).toBe("PRODUCTION");
      expect(deploymentPlan.provider).toBe("DEV_FIXTURE");
      expect(deploymentPlan.budgetExceeded).toBe(false);
      expect(memo.recommendation.length).toBeGreaterThan(0);

      // A human APPROVEs the launch thesis — Product stays
      // AWAITING_LAUNCH_APPROVAL (§31): this alone never deploys anything.
      const decidedMemo = await launchReviewMemoService.recordHumanDecision({ memoId: memo.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });
      expect(decidedMemo.humanDecision).toBe("APPROVE");
      expect((await productService.getOrThrow(product.id)).status).toBe("AWAITING_LAUNCH_APPROVAL");

      // A SEPARATE, exact-action-bound RED-risk approval on the DeploymentPlan itself (§5-6, §17).
      const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan.id, requestedByAgentId: agents.launchStrategistAgent.id });
      expect(approvalRequest.riskLevel).toBe("RED");
      expect(approvalRequest.resourceType).toBe("DEPLOYMENT_PLAN");
      expect(approvalRequest.resourceId).toBe(deploymentPlan.id);

      await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
      const approvedPlan = await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
      expect(approvedPlan.status).toBe("HUMAN_APPROVED");

      // The EXECUTE step — a THIRD, separate human action, only now does anything "real" (fixture-scoped) happen.
      const deployment = await deploymentService.execute({ deploymentPlanId: deploymentPlan.id, actor: HUMAN_OWNER });
      expect(deployment.status).toBe("LIVE");
      expect(deployment.provider).toBe("DEV_FIXTURE");
      expect(deployment.providerRef).toMatch(/^dev-deploy-/);

      const liveProduct = await productService.getOrThrow(product.id);
      expect(liveProduct.status).toBe("LIVE");
      const executedPlan = await deploymentPlanService.getOrThrow(deploymentPlan.id);
      expect(executedPlan.status).toBe("EXECUTED");

      // On-demand health check (§12, §24) — never a background poll.
      const health = await monitoringService.checkHealth({ deploymentId: deployment.id });
      expect(health.healthy).toBe(true);

      // Real BusinessMetric rows, structurally distinguishing observed fact from estimate (§16, §23, Section 45's "no fake business").
      const uptimeMetric = await businessMetricRepository.create({ productId: product.id, metricType: "UPTIME_PCT", valueKind: "OBSERVED", value: health.healthy ? 100 : 0, source: "DEV_FIXTURE" });
      expect(uptimeMetric.valueKind).toBe("OBSERVED");
      const costMetric = await businessMetricRepository.create({ productId: product.id, metricType: "MONTHLY_OPERATING_COST_USD", valueKind: "ESTIMATED", value: deploymentPlan.estimatedCostUsd, source: "COMPUTED_ESTIMATE" });
      expect(costMetric.valueKind).toBe("ESTIMATED");

      const metrics = await businessMetricRepository.listForProduct(product.id);
      expect(metrics.length).toBeGreaterThanOrEqual(2);
      // Structural guarantee: never a metric with no labeled kind or source.
      expect(metrics.every((m) => m.valueKind === "OBSERVED" || m.valueKind === "ESTIMATED")).toBe(true);
      expect(metrics.every((m) => m.source.length > 0)).toBe(true);

      // A real follow-up operating recommendation from the CEO, now that the product is live (§28).
      const ceoOutcome = await ceoReasoningService.recommendLaunchOperationsAction({ agentId: agents.ceoAgent.id, productId: product.id, startedBy: authActor() });
      expect(ceoOutcome.status).toBe("COMPLETED");
      if (ceoOutcome.status === "COMPLETED") {
        expect(ceoOutcome.result.recommendation.reasoning.length).toBeGreaterThan(0);
        expect(JSON.parse(ceoOutcome.result.recommendation.citedClaimIds).length).toBeGreaterThan(0);
      }

      // No fake business (Section 45): nothing here ever claims real revenue/customers — every fixture is DEV_FIXTURE-labeled.
      expect(deployment.detail).toContain("DEV_FIXTURE");
    },
    { timeout: 180_000 },
  );
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeReviewRepository } from "../../src/db/repositories/code-review.repository.js";
import { deploymentPlanRepository } from "../../src/db/repositories/deployment-plan.repository.js";
import { launchPlanRepository } from "../../src/db/repositories/launch-plan.repository.js";
import { qaReportRepository } from "../../src/db/repositories/qa-report.repository.js";
import { securityReviewRepository } from "../../src/db/repositories/security-review.repository.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { codeReviewAgentService } from "../../src/services/code-review-agent.service.js";
import { engineeringAgentService } from "../../src/services/engineering-agent.service.js";
import { engineeringTaskService } from "../../src/services/engineering-task.service.js";
import { gtmAgentService } from "../../src/services/gtm-agent.service.js";
import { launchReviewMemoService } from "../../src/services/launch-review-memo.service.js";
import { mvpArchitectService } from "../../src/services/mvp-architect.service.js";
import { pricingAgentService } from "../../src/services/pricing-agent.service.js";
import { productReviewMemoService } from "../../src/services/product-review-memo.service.js";
import { productService } from "../../src/services/product.service.js";
import { productStrategistService } from "../../src/services/product-strategist.service.js";
import { qaAgentService } from "../../src/services/qa-agent.service.js";
import { securityReviewAgentService } from "../../src/services/security-review-agent.service.js";
import { uxAgentService } from "../../src/services/ux-agent.service.js";
import { workspaceService } from "../../src/services/workspace.service.js";
import { createDeploymentProvider } from "../../src/providers/deployment-provider-factory.js";
import { toolRegistry } from "../../src/tools/tool-registry.js";
import { authActor, HUMAN_OWNER, makeApprovedProduct, makeReadyForDeploymentProduct } from "../helpers.js";

/**
 * M7 mandatory capstone #2a: cost/economics blocks launch
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §40.2) —
 * cost-exceeds-budget -> Chairman margin/budget objection -> CEO
 * REDUCE_COST -> Human DELAY (REQUEST_CHANGES, back to LAUNCH_PLANNING).
 * A real over-budget DeploymentPlan is constructed directly (the dev
 * fixture's own real architecture never organically produces enough
 * external-dependency cost to cross the $200/month ceiling) — the
 * same "construct the specific real scenario downstream logic must
 * react to" technique docs/M6_ARCHITECTURE_PROPOSAL.md's own negative
 * capstone used for its security injection, applied here at the data
 * layer since budgetExceeded is plain application data, not something
 * behind a Guardian-gated write.
 */
describe("M7 capstone: negative path — cost exceeds budget", () => {
  it(
    "an over-budget deployment plan blocks launch: Chairman objects, CEO recommends REDUCE_COST, and a human DELAY (REQUEST_CHANGES) sends the product back to LAUNCH_PLANNING",
    async () => {
      const { agents, product: initialProduct } = await makeReadyForDeploymentProduct();
      let product = initialProduct;
      const actor = HUMAN_OWNER;

      product = await productService.setStatus(product.id, "LAUNCH_PLANNING", actor);

      const pricingOutcome = await pricingAgentService.run({ agentId: agents.pricingAgent.id, productId: product.id, startedBy: authActor() });
      if (pricingOutcome.status !== "COMPLETED") throw new Error("pricing agent did not complete");
      const gtmOutcome = await gtmAgentService.run({ agentId: agents.gtmAgent.id, productId: product.id, startedBy: authActor() });
      if (gtmOutcome.status !== "COMPLETED") throw new Error("gtm agent did not complete");

      // A real, over-budget DeploymentPlan — $500/month against the $200 ceiling checkLaunchBudget enforces.
      const overBudgetPlan = await deploymentPlanRepository.create({
        productId: product.id,
        environment: "PRODUCTION",
        provider: createDeploymentProvider().id,
        strategy: "Deploy behind a load balancer with redundant instances across two regions.",
        estimatedCostUsd: 500,
        rollbackPlan: "Roll back to the previous known-good deployment.",
        artifactRef: product.workspacePath ?? product.id,
        budgetExceeded: true,
      });
      expect(overBudgetPlan.budgetExceeded).toBe(true);

      const launchPlan = await launchPlanRepository.create({
        productId: product.id,
        deploymentPlanId: overBudgetPlan.id,
        summary: JSON.stringify({ deployment: { estimatedCostUsd: overBudgetPlan.estimatedCostUsd, budgetExceeded: true } }),
      });
      await launchPlanRepository.attachPricingModel(launchPlan.id, pricingOutcome.result.pricingModel.id);
      await launchPlanRepository.attachGoToMarketPlan(launchPlan.id, gtmOutcome.result.goToMarketPlan.id);

      const ceoOutcome = await ceoReasoningService.recommendLaunchOperationsAction({ agentId: agents.ceoAgent.id, productId: product.id, startedBy: authActor() });
      expect(ceoOutcome.status).toBe("COMPLETED");
      if (ceoOutcome.status !== "COMPLETED") return;
      expect(ceoOutcome.result.recommendation.action).toBe("REDUCE_COST");

      const { review: chairmanReview } = await chairmanService.reviewLaunch({ productId: product.id, reviewedBy: authActor() });
      expect(chairmanReview.decision).toBe("REJECT");
      const objections: string[] = JSON.parse(chairmanReview.objections);
      expect(objections.some((o) => /budget/i.test(o))).toBe(true);

      const memo = await launchReviewMemoService.compile({ productId: product.id, launchPlan, ceoRecommendation: ceoOutcome.result.recommendation, chairmanReview, actor });
      product = await productService.setStatus(product.id, "AWAITING_LAUNCH_APPROVAL", actor);

      // DELAY the launch — a human weighing Chairman's REJECT still chooses REQUEST_CHANGES over an outright REJECT: fix the cost, come back.
      const decided = await launchReviewMemoService.recordHumanDecision({ memoId: memo.id, humanDecision: "REQUEST_CHANGES", humanReason: "Delay: reduce estimated hosting cost before relaunching.", actor: HUMAN_OWNER });
      expect(decided.humanDecision).toBe("REQUEST_CHANGES");
      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("LAUNCH_PLANNING");
    },
    { timeout: 180_000 },
  );
});

/**
 * M7 mandatory capstone #2b: security failure blocks launch
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §40.3) — a Product that reached
 * READY_FOR_DEPLOYMENT only because a human overrode a real,
 * deterministically-detected security FAIL when approving the M6
 * ProductReviewMemo (the Constitution gives the Human Owner that
 * authority) still never reaches LIVE: the Chairman's reviewLaunch
 * independently RE-CHECKS the same SecurityReview verdict, never
 * taking the earlier human override on faith, and blocks the launch
 * regardless of how strong the pricing/GTM case is.
 */
describe("M7 capstone: negative path — security failure blocks launch", () => {
  it(
    "a real security FAIL, overridden once at the M6 build-approval gate, is still caught by the Chairman's own independent launch review and never reaches LIVE",
    async () => {
      const { agents, product: initialProduct } = await makeApprovedProduct();
      let product = initialProduct;
      const actor = HUMAN_OWNER;

      product = await productService.setStatus(product.id, "SPECIFYING", actor);
      const strategistOutcome = await productStrategistService.run({ agentId: agents.productStrategistAgent.id, productId: product.id, startedBy: authActor() });
      if (strategistOutcome.status !== "COMPLETED") throw new Error("strategist did not complete");

      product = await productService.setStatus(product.id, "ARCHITECTING", actor);
      const architectOutcome = await mvpArchitectService.run({ agentId: agents.mvpArchitectAgent.id, productSpecId: strategistOutcome.result.productSpec.id, startedBy: authActor() });
      if (architectOutcome.status !== "COMPLETED") throw new Error("architect did not complete");
      const uxOutcome = await uxAgentService.run({ agentId: agents.uxAgent.id, mvpArchitectureId: architectOutcome.result.mvpArchitecture.id, startedBy: authActor() });
      if (uxOutcome.status !== "COMPLETED") throw new Error("ux did not complete");

      product = await productService.setStatus(product.id, "BUILDING", actor);
      const workspacePath = await workspaceService.provision(product.id);
      const [storeTask, apiTask] = await engineeringTaskService.decomposeFromArchitecture(uxOutcome.result.mvpArchitecture.id, agents.engineeringAgent.id);

      const storeOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      if (storeOutcome.status !== "COMPLETED" || !storeOutcome.result.typecheckPassed) throw new Error("store task did not complete cleanly");
      const apiOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });
      if (apiOutcome.status !== "COMPLETED" || !apiOutcome.result.typecheckPassed) throw new Error("api task did not complete cleanly");

      // Same real, deterministically-detectable code-injection pattern docs/M6_ARCHITECTURE_PROPOSAL.md's own negative capstone injects, through the same Guardian-gated tool.
      const currentStoreContent = await readFile(join(workspacePath, "src", "store.ts"), "utf-8");
      const writeTool = toolRegistry.get("write_workspace_file")!;
      await writeTool.execute(
        { workspacePath, relativePath: "src/store.ts", content: `${currentStoreContent}\nexport const __debugEval = () => eval("1");\n` },
        { agentId: agents.engineeringAgent.id, executionId: "m7-negative-security-injection" },
      );

      product = await productService.setStatus(product.id, "REVIEWING", actor);
      await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      product = await productService.setStatus(product.id, "TESTING", actor);
      await qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      await qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      product = await productService.setStatus(product.id, "SECURITY_REVIEW", actor);
      const securityOutcome = await securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      expect(securityOutcome.status).toBe("COMPLETED");
      if (securityOutcome.status === "COMPLETED") expect(securityOutcome.result.securityReview.verdict).toBe("FAIL");
      await securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      const ceoOutcome = await ceoReasoningService.recommendProductBuildAction({ agentId: agents.ceoAgent.id, productId: product.id, startedBy: authActor() });
      if (ceoOutcome.status !== "COMPLETED") throw new Error("ceo product-build recommendation did not complete");
      const { review: chairmanProductReview } = await chairmanService.reviewProduct({ productId: product.id, reviewedBy: authActor() });

      const buildMemo = await productReviewMemoService.compile({
        productId: product.id,
        productSpec: strategistOutcome.result.productSpec,
        mvpArchitecture: uxOutcome.result.mvpArchitecture,
        ceoRecommendation: ceoOutcome.result.recommendation,
        chairmanReview: chairmanProductReview,
        actor,
      });
      await productService.setStatus(product.id, "HUMAN_REVIEW", actor);

      // The human OVERRIDES the real FAIL — their own authority (Constitution §2), not a mistake this test relies on.
      await productReviewMemoService.recordHumanDecision({ memoId: buildMemo.id, humanDecision: "APPROVE", humanReason: "Accepting risk for this test scenario — proceeding despite the flagged security finding.", actor: HUMAN_OWNER });
      const readyProduct = await productService.getOrThrow(product.id);
      expect(readyProduct.status).toBe("READY_FOR_DEPLOYMENT");

      // The M7 launch pipeline — the Chairman re-checks the same SecurityReview verdict independently, never trusting the earlier human override.
      product = await productService.setStatus(product.id, "LAUNCH_PLANNING", actor);
      const pricingOutcome = await pricingAgentService.run({ agentId: agents.pricingAgent.id, productId: product.id, startedBy: authActor() });
      if (pricingOutcome.status !== "COMPLETED") throw new Error("pricing agent did not complete");
      const gtmOutcome = await gtmAgentService.run({ agentId: agents.gtmAgent.id, productId: product.id, startedBy: authActor() });
      if (gtmOutcome.status !== "COMPLETED") throw new Error("gtm agent did not complete");

      const deploymentPlan = await deploymentPlanRepository.create({
        productId: product.id,
        environment: "PRODUCTION",
        provider: createDeploymentProvider().id,
        strategy: "Deploy the workspace's built artifact.",
        estimatedCostUsd: readyProduct.estimatedOperatingCostUsd ?? 0,
        rollbackPlan: readyProduct.rollbackPlan ?? "Roll back to the previous known-good deployment.",
        artifactRef: readyProduct.workspacePath ?? readyProduct.id,
        budgetExceeded: false,
      });
      const launchPlan = await launchPlanRepository.create({ productId: product.id, deploymentPlanId: deploymentPlan.id, summary: "{}" });
      await launchPlanRepository.attachPricingModel(launchPlan.id, pricingOutcome.result.pricingModel.id);
      await launchPlanRepository.attachGoToMarketPlan(launchPlan.id, gtmOutcome.result.goToMarketPlan.id);

      const ceoLaunchOutcome = await ceoReasoningService.recommendLaunchOperationsAction({ agentId: agents.ceoAgent.id, productId: product.id, startedBy: authActor() });
      if (ceoLaunchOutcome.status !== "COMPLETED") throw new Error("ceo launch-operations recommendation did not complete");

      const { review: launchChairmanReview } = await chairmanService.reviewLaunch({ productId: product.id, reviewedBy: authActor() });
      expect(launchChairmanReview.decision).toBe("REJECT");
      const launchObjections: string[] = JSON.parse(launchChairmanReview.objections);
      expect(launchObjections.some((o) => /security/i.test(o))).toBe(true);

      // Independently re-verified, not just re-stated: the same real findings this build's own SecurityReview recorded are still on file.
      const storedSecurityReview = await securityReviewRepository.findLatestForTask(storeTask!.id);
      expect(storedSecurityReview?.verdict).toBe("FAIL");

      const launchMemo = await launchReviewMemoService.compile({ productId: product.id, launchPlan, ceoRecommendation: ceoLaunchOutcome.result.recommendation, chairmanReview: launchChairmanReview, actor });
      await productService.setStatus(product.id, "AWAITING_LAUNCH_APPROVAL", actor);
      const decidedLaunchMemo = await launchReviewMemoService.recordHumanDecision({ memoId: launchMemo.id, humanDecision: "REJECT", humanReason: "Real security failure — do not launch.", actor: HUMAN_OWNER });
      expect(decidedLaunchMemo.humanDecision).toBe("REJECT");

      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("FAILED");
      expect(finalProduct.status).not.toBe("LIVE");

      // No code path here ever reached DEPLOYING/LIVE — cross-checked directly, not merely inferred from the memo's own decision.
      const codeReview = await codeReviewRepository.findLatestForTask(storeTask!.id);
      const qaReport = await qaReportRepository.findLatestForTask(storeTask!.id);
      expect(codeReview).not.toBeNull();
      expect(qaReport).not.toBeNull();
    },
    { timeout: 180_000 },
  );
});

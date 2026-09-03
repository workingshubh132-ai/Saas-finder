import { describe, expect, it } from "vitest";
import { productFactoryService } from "../../src/services/product-factory.service.js";
import { productReviewMemoService } from "../../src/services/product-review-memo.service.js";
import { productService } from "../../src/services/product.service.js";
import { engineeringTaskRepository } from "../../src/db/repositories/engineering-task.repository.js";
import { auditService } from "../../src/services/audit.service.js";
import { authActor, makeApprovedProduct, HUMAN_OWNER } from "../helpers.js";

describe("productFactoryService.build", () => {
  it(
    "drives a real Product all the way from APPROVED to HUMAN_REVIEW with a real, compiled, BUILD-recommending memo",
    async () => {
      const { agents, product } = await makeApprovedProduct();

      const summary = await productFactoryService.build({
        productId: product.id,
        strategistAgentId: agents.productStrategistAgent.id,
        architectAgentId: agents.mvpArchitectAgent.id,
        uxAgentId: agents.uxAgent.id,
        engineeringAgentId: agents.engineeringAgent.id,
        codeReviewAgentId: agents.codeReviewAgent.id,
        qaAgentId: agents.qaAgent.id,
        securityAgentId: agents.securityReviewAgent.id,
        ceoAgentId: agents.ceoAgent.id,
        startedBy: authActor(),
      });

      expect(summary.stoppedReason).toBeNull();
      expect(summary.product.status).toBe("HUMAN_REVIEW");
      expect(summary.productSpec).not.toBeNull();
      expect(summary.mvpArchitecture).not.toBeNull();
      expect(summary.engineeringTasks).toHaveLength(2);
      expect(summary.engineeringTasks.every((t) => t.status === "COMPLETED")).toBe(true);

      // Integration test actually ran and its result was recorded on every task.
      const refetchedTasks = await Promise.all(summary.engineeringTasks.map((t) => engineeringTaskRepository.findById(t.id)));
      expect(refetchedTasks.every((t) => t?.integrationTestPassed === true)).toBe(true);

      expect(summary.ceoRecommendation?.action).toBe("BUILD");
      expect(summary.chairmanReview?.decision).toBe("APPROVE");
      expect(summary.memo).not.toBeNull();
      expect(summary.memo?.humanDecision).toBeNull();

      const memoContent = JSON.parse(summary.memo!.content);
      expect(memoContent.engineeringSummary.tasksTotal).toBe(2);
      expect(memoContent.engineeringSummary.tasksCompleted).toBe(2);
      expect(memoContent.codeReviewSummary.blockingFindingCount).toBe(0);
      expect(memoContent.securitySummary.failCount).toBe(0);

      const entries = await auditService.list({ resourceType: "PRODUCT", resourceId: product.id });
      expect(entries.some((e) => e.action === "PRODUCT_FACTORY_COMPLETED")).toBe(true);
    },
    { timeout: 120_000 },
  );

  it(
    "lets the Human Owner approve a HUMAN_REVIEW memo, moving the Product to READY_FOR_DEPLOYMENT",
    async () => {
      const { agents, product } = await makeApprovedProduct();
      const summary = await productFactoryService.build({
        productId: product.id,
        strategistAgentId: agents.productStrategistAgent.id,
        architectAgentId: agents.mvpArchitectAgent.id,
        uxAgentId: agents.uxAgent.id,
        engineeringAgentId: agents.engineeringAgent.id,
        codeReviewAgentId: agents.codeReviewAgent.id,
        qaAgentId: agents.qaAgent.id,
        securityAgentId: agents.securityReviewAgent.id,
        ceoAgentId: agents.ceoAgent.id,
        startedBy: authActor(),
      });

      const decided = await productReviewMemoService.recordHumanDecision({
        memoId: summary.memo!.id,
        humanDecision: "APPROVE",
        humanReason: "Looks good — a real, minimal, working MVP.",
        actor: HUMAN_OWNER,
      });
      expect(decided.humanDecision).toBe("APPROVE");
      expect(decided.decidedAt).not.toBeNull();

      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("READY_FOR_DEPLOYMENT");
    },
    { timeout: 120_000 },
  );

  it("refuses to build a Product that is not APPROVED", async () => {
    const { agents, product } = await makeApprovedProduct();
    // Consume the one legal APPROVED -> SPECIFYING transition directly, leaving the product no longer APPROVED.
    await productService.setStatus(product.id, "SPECIFYING", { actorType: "SYSTEM", actorId: null });

    await expect(
      productFactoryService.build({
        productId: product.id,
        strategistAgentId: agents.productStrategistAgent.id,
        architectAgentId: agents.mvpArchitectAgent.id,
        uxAgentId: agents.uxAgent.id,
        engineeringAgentId: agents.engineeringAgent.id,
        codeReviewAgentId: agents.codeReviewAgent.id,
        qaAgentId: agents.qaAgent.id,
        securityAgentId: agents.securityReviewAgent.id,
        ceoAgentId: agents.ceoAgent.id,
        startedBy: authActor(),
      }),
    ).rejects.toThrow(/only builds an APPROVED product/);
  });
});

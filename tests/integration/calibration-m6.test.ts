import { describe, expect, it } from "vitest";
import { calibrationService } from "../../src/services/calibration.service.js";
import { productFactoryService } from "../../src/services/product-factory.service.js";
import { productReviewMemoService } from "../../src/services/product-review-memo.service.js";
import { authActor, makeApprovedProduct, HUMAN_OWNER } from "../helpers.js";

async function buildAndGetMemo() {
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
  return summary.memo!;
}

describe("calibrationService.summarizeProductBuilds", () => {
  it(
    "buckets a decided ProductReviewMemo by its own real confidence and computes the APPROVE rate",
    async () => {
      const memo = await buildAndGetMemo();
      await productReviewMemoService.recordHumanDecision({ memoId: memo.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });

      const summary = await calibrationService.summarizeProductBuilds();
      const bucket = summary.buckets.find((b) => memo.confidence >= parseFloat(b.range.split("-")[0]!) && memo.confidence <= parseFloat(b.range.split("-")[1]!));
      expect(bucket).toBeDefined();
      expect(bucket!.count).toBeGreaterThanOrEqual(1);
      expect(bucket!.approvedCount).toBeGreaterThanOrEqual(1);
    },
    { timeout: 60_000 },
  );

  it(
    "excludes an undecided ProductReviewMemo (humanDecision still null) from totalDecisions",
    async () => {
      const before = await calibrationService.summarizeProductBuilds();
      await buildAndGetMemo(); // never decided
      const after = await calibrationService.summarizeProductBuilds();

      expect(after.totalDecisions).toBe(before.totalDecisions);
    },
    { timeout: 60_000 },
  );
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeReviewRepository } from "../../src/db/repositories/code-review.repository.js";
import { securityReviewRepository } from "../../src/db/repositories/security-review.repository.js";
import { ceoReasoningService } from "../../src/services/ceo-reasoning.service.js";
import { chairmanService } from "../../src/services/chairman.service.js";
import { codeReviewAgentService } from "../../src/services/code-review-agent.service.js";
import { engineeringAgentService } from "../../src/services/engineering-agent.service.js";
import { engineeringTaskService } from "../../src/services/engineering-task.service.js";
import { mvpArchitectService } from "../../src/services/mvp-architect.service.js";
import { productFactoryService } from "../../src/services/product-factory.service.js";
import { productReviewMemoService } from "../../src/services/product-review-memo.service.js";
import { productService } from "../../src/services/product.service.js";
import { productStrategistService } from "../../src/services/product-strategist.service.js";
import { qaAgentService } from "../../src/services/qa-agent.service.js";
import { securityReviewAgentService } from "../../src/services/security-review-agent.service.js";
import { uxAgentService } from "../../src/services/ux-agent.service.js";
import { workspaceService } from "../../src/services/workspace.service.js";
import { toolRegistry } from "../../src/tools/tool-registry.js";
import { authActor, makeApprovedProduct, HUMAN_OWNER } from "../helpers.js";

/**
 * The three mandatory M6 capstone tests (docs/M6_ARCHITECTURE_PROPOSAL.md
 * — positive / negative / code-quality), mirroring the shape M4/M5
 * established for their own capstones: real data, the real pipeline,
 * never a mocked shortcut.
 */
describe("M6 capstone: positive path", () => {
  it(
    "a genuinely clean build reaches BUILD/APPROVE and, once the Human Owner approves, READY_FOR_DEPLOYMENT",
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
      expect(summary.engineeringTasks.every((t) => t.status === "COMPLETED")).toBe(true);
      expect(summary.ceoRecommendation?.action).toBe("BUILD");
      expect(summary.chairmanReview?.decision).toBe("APPROVE");
      expect(summary.product.status).toBe("HUMAN_REVIEW");
      expect(summary.product.estimatedDevelopmentCostUsd).toBeGreaterThan(0);
      expect(summary.product.deploymentPlan).toContain("PLAN only");

      const decided = await productReviewMemoService.recordHumanDecision({ memoId: summary.memo!.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });
      expect(decided.humanDecision).toBe("APPROVE");
      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("READY_FOR_DEPLOYMENT");
    },
    { timeout: 120_000 },
  );
});

describe("M6 capstone: negative path", () => {
  it(
    "a real, deterministically-detected security vulnerability propagates through Code Review, Security Review, the CEO's product-build recommendation, and the Chairman's own product review, ending in REJECTED",
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

      // Inject a REAL, deterministically-detectable vulnerability into the already-COMPLETED store.ts —
      // through the same Guardian-gated write_workspace_file tool the Engineering Agent itself uses, never
      // a shortcut around it. `eval("1")` is valid TypeScript (typechecks cleanly) but is exactly the
      // code-injection pattern src/domain/security-review/security-scan.ts is built to catch.
      const currentStoreContent = await readFile(join(workspacePath, "src", "store.ts"), "utf-8");
      const writeTool = toolRegistry.get("write_workspace_file")!;
      await writeTool.execute(
        { workspacePath, relativePath: "src/store.ts", content: `${currentStoreContent}\nexport const __debugEval = () => eval("1");\n` },
        { agentId: agents.engineeringAgent.id, executionId: "capstone-negative-injection" },
      );

      product = await productService.setStatus(product.id, "REVIEWING", actor);
      const codeReviewOutcome = await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      expect(codeReviewOutcome.status).toBe("COMPLETED");
      if (codeReviewOutcome.status === "COMPLETED") expect(codeReviewOutcome.result.codeReview.hasBlockingFinding).toBe(true);
      await codeReviewAgentService.run({ agentId: agents.codeReviewAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      product = await productService.setStatus(product.id, "TESTING", actor);
      await qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      await qaAgentService.run({ agentId: agents.qaAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      product = await productService.setStatus(product.id, "SECURITY_REVIEW", actor);
      const securityOutcome = await securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
      expect(securityOutcome.status).toBe("COMPLETED");
      if (securityOutcome.status === "COMPLETED") {
        expect(securityOutcome.result.securityReview.verdict).toBe("FAIL");
        const findings = JSON.parse(securityOutcome.result.securityReview.findings);
        expect(findings.some((f: { category: string }) => f.category === "code-injection")).toBe(true);
      }
      await securityReviewAgentService.run({ agentId: agents.securityReviewAgent.id, engineeringTaskId: apiTask!.id, startedBy: authActor() });

      const ceoOutcome = await ceoReasoningService.recommendProductBuildAction({ agentId: agents.ceoAgent.id, productId: product.id, startedBy: authActor() });
      expect(ceoOutcome.status).toBe("COMPLETED");
      if (ceoOutcome.status !== "COMPLETED") return;
      expect(ceoOutcome.result.recommendation.action).toBe("STOP");

      const { review: chairmanReview } = await chairmanService.reviewProduct({ productId: product.id, reviewedBy: authActor() });
      expect(chairmanReview.decision).toBe("REJECT");
      const objections: string[] = JSON.parse(chairmanReview.objections);
      expect(objections.some((o) => /security/i.test(o))).toBe(true);

      const memo = await productReviewMemoService.compile({
        productId: product.id,
        productSpec: strategistOutcome.result.productSpec,
        mvpArchitecture: uxOutcome.result.mvpArchitecture,
        ceoRecommendation: ceoOutcome.result.recommendation,
        chairmanReview,
        actor,
      });
      await productService.setStatus(product.id, "HUMAN_REVIEW", actor);

      const decided = await productReviewMemoService.recordHumanDecision({ memoId: memo.id, humanDecision: "REJECT", humanReason: "Real security failure — do not ship.", actor: HUMAN_OWNER });
      expect(decided.humanDecision).toBe("REJECT");
      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("REJECTED");
    },
    { timeout: 120_000 },
  );
});

describe("M6 capstone: generated code quality", () => {
  it(
    "the generated product's own code is real, minimal, and behaviorally correct — real input validation, real error responses, zero dangerous patterns, real passing tests",
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
      const workspacePath = (await productService.getOrThrow(product.id)).workspacePath!;

      const [routesContent, storeContent] = await Promise.all([readFile(join(workspacePath, "src", "routes.ts"), "utf-8"), readFile(join(workspacePath, "src", "store.ts"), "utf-8")]);

      // Real input validation and real structured error responses — never a blind trust of req.body, never an unhandled exception path.
      expect(routesContent).toMatch(/isValidBody|safeParse|\.parse\(/);
      expect(routesContent).toContain("400");
      expect(routesContent).not.toMatch(/\beval\(|\bnew Function\(/);
      expect(storeContent).not.toMatch(/\beval\(|\bnew Function\(/);

      // The generated code is not a stub: real exported functions with real bodies.
      expect(storeContent).toMatch(/export function create\(/);
      expect(storeContent).toMatch(/export function list\(/);

      // Every task's own real Code Review / QA / Security verdicts, already recorded by the build above, are clean — not merely a typecheck pass.
      for (const task of summary.engineeringTasks) {
        const codeReview = await codeReviewRepository.findLatestForTask(task.id);
        expect(codeReview?.hasBlockingFinding).toBe(false);
        const securityReview = await securityReviewRepository.findLatestForTask(task.id);
        expect(securityReview?.verdict).toBe("PASS");
      }

      // The generated workspace's own real test suite genuinely passes — not merely typechecks.
      const runCommand = toolRegistry.get("run_workspace_command")!;
      const testResult = (await runCommand.execute({ workspacePath, command: "test" }, { agentId: agents.engineeringAgent.id, executionId: "capstone-code-quality" })) as { exitCode: number; stdout: string; stderr: string };
      expect(testResult.exitCode, `${testResult.stdout}\n${testResult.stderr}`).toBe(0);
    },
    { timeout: 120_000 },
  );
});

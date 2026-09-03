import type { CeoRecommendation, ChairmanReview, EngineeringTask, MvpArchitecture, Product, ProductReviewMemo, ProductSpec } from "@prisma/client";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeCostEstimate } from "../domain/product/cost-estimate.js";
import { compileDeploymentPlan, compileRollbackPlan } from "../domain/product/deployment-plan.js";
import { MAX_TASK_ATTEMPTS } from "../domain/engineering-task/engineering-task.types.js";
import { fromJsonString } from "../domain/shared/json.js";
import { ValidationError } from "../domain/shared/errors.js";
import { agentRuntimeService } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { ceoReasoningService } from "./ceo-reasoning.service.js";
import { chairmanService } from "./chairman.service.js";
import { codeReviewAgentService } from "./code-review-agent.service.js";
import { engineeringAgentService } from "./engineering-agent.service.js";
import { engineeringTaskService } from "./engineering-task.service.js";
import { mvpArchitectService } from "./mvp-architect.service.js";
import { productReviewMemoService } from "./product-review-memo.service.js";
import { productService } from "./product.service.js";
import { productStrategistService } from "./product-strategist.service.js";
import { qaAgentService } from "./qa-agent.service.js";
import { securityReviewAgentService } from "./security-review-agent.service.js";
import { uxAgentService } from "./ux-agent.service.js";
import { workspaceService } from "./workspace.service.js";

export interface BuildProductParams {
  productId: string;
  strategistAgentId: string;
  architectAgentId: string;
  uxAgentId: string;
  engineeringAgentId: string;
  codeReviewAgentId: string;
  qaAgentId: string;
  securityAgentId: string;
  ceoAgentId: string;
  startedBy: AuthenticatedActor;
}

export interface ProductFactorySummary {
  product: Product;
  productSpec: ProductSpec | null;
  mvpArchitecture: MvpArchitecture | null;
  engineeringTasks: EngineeringTask[];
  ceoRecommendation: CeoRecommendation | null;
  chairmanReview: ChairmanReview | null;
  memo: ProductReviewMemo | null;
  stoppedReason: string | null;
}

function toActor(startedBy: AuthenticatedActor): { actorType: "HUMAN" | "AGENT" | "SYSTEM"; actorId: string } {
  return { actorType: startedBy.type, actorId: startedBy.id };
}

/** Runs the whole workspace's real test suite once, mechanically — the Integration Test pipeline stage (docs/M6_ARCHITECTURE_PROPOSAL.md §2's own REVIEWING/TESTING/SECURITY_REVIEW mapping: TESTING = QA + Integration Test), never a judgment call, so zero model calls. */
async function runIntegrationTest(params: { agentId: string; workspacePath: string; startedBy: AuthenticatedActor; tasks: readonly EngineeringTask[] }): Promise<{ passed: boolean; output: string }> {
  const execution = await agentRuntimeService.startExecution({
    agentId: params.agentId,
    taskId: null,
    input: { workspacePath: params.workspacePath, mode: "INTEGRATION_TEST" },
    startedBy: params.startedBy,
  });

  const outcome = await agentRuntimeService.run(
    execution.id,
    async (handle) => {
      handle.step();
      const result = (await handle.callTool("run_workspace_command", { workspacePath: params.workspacePath, command: "test" })) as { exitCode: number; stdout: string; stderr: string };
      await handle.transition("PROCESSING_RESULT");
      handle.step();
      return { passed: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
    },
    { maxSteps: 4, maxToolCalls: 1, maxModelCalls: 0, maxRetries: 1, maxDurationMs: 60_000 },
  );

  const passed = outcome.status === "COMPLETED" && outcome.result.passed;
  const output = outcome.status === "COMPLETED" ? outcome.result.output : "Integration test execution did not complete.";
  await Promise.all(params.tasks.map((task) => engineeringTaskRepository.recordIntegrationTest(task.id, { integrationTestPassed: passed, integrationTestOutput: output.slice(0, 4000) })));
  return { passed, output };
}

/**
 * The factory orchestrator (docs/M6_ARCHITECTURE_PROPOSAL.md §2,
 * §21, §34) — deterministic orchestration CODE, layered on top of the
 * unchanged Product Strategist/MVP Architect/UX/Engineering/Code
 * Review/QA/Security agents and productService's own state machine,
 * mirroring decisionCycleService's own precedent (M4): drives Product
 * through its real lifecycle, stops cleanly and preserves every
 * already-committed row on any failure, never rolls back partial
 * work. Bounded retry (§28) applies ONLY to Engineering's own
 * mechanical typecheck failure (engineeringTaskService.recordAttempt,
 * capped at MAX_TASK_ATTEMPTS) — Code Review/QA/Security verdicts are
 * JUDGMENT outcomes that always flow through to the CEO/Chairman/memo
 * as real, honest findings, never silently retried or looped; a
 * human's own REQUEST_CHANGES decision on the compiled memo (§22) is
 * the one legitimate path back to BUILDING.
 */
export const productFactoryService = {
  async build(params: BuildProductParams): Promise<ProductFactorySummary> {
    let product = await productService.getOrThrow(params.productId);
    if (product.status !== "APPROVED") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — the factory only builds an APPROVED product.`);
    }
    const actor = toActor(params.startedBy);

    const fail = async (reason: string): Promise<ProductFactorySummary> => {
      product = await productService.setStatus(product.id, "FAILED", actor);
      await auditService.record({ actorType: actor.actorType, actorId: actor.actorId, action: "PRODUCT_FACTORY_STOPPED", resourceType: "PRODUCT", resourceId: product.id, result: "FAILURE", reason });
      return { product, productSpec, mvpArchitecture, engineeringTasks, ceoRecommendation: null, chairmanReview: null, memo: null, stoppedReason: reason };
    };

    let productSpec: ProductSpec | null = null;
    let mvpArchitecture: MvpArchitecture | null = null;
    let engineeringTasks: EngineeringTask[] = [];

    // SPECIFYING
    product = await productService.setStatus(product.id, "SPECIFYING", actor);
    const strategistOutcome = await productStrategistService.run({ agentId: params.strategistAgentId, productId: product.id, startedBy: params.startedBy });
    if (strategistOutcome.status !== "COMPLETED") return fail("Product Strategist did not complete.");
    productSpec = strategistOutcome.result.productSpec;

    // ARCHITECTING
    product = await productService.setStatus(product.id, "ARCHITECTING", actor);
    const architectOutcome = await mvpArchitectService.run({ agentId: params.architectAgentId, productSpecId: productSpec.id, startedBy: params.startedBy });
    if (architectOutcome.status !== "COMPLETED") return fail("MVP Architect did not complete.");
    mvpArchitecture = architectOutcome.result.mvpArchitecture;

    const uxOutcome = await uxAgentService.run({ agentId: params.uxAgentId, mvpArchitectureId: mvpArchitecture.id, startedBy: params.startedBy });
    if (uxOutcome.status !== "COMPLETED") return fail("UX Agent did not complete.");
    mvpArchitecture = uxOutcome.result.mvpArchitecture;

    // BUILDING
    product = await productService.setStatus(product.id, "BUILDING", actor);
    const workspacePath = await workspaceService.provision(product.id);
    engineeringTasks = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, params.engineeringAgentId);

    const completedTasks: EngineeringTask[] = [];
    for (const task of engineeringTasks) {
      let current = task;
      let succeeded = false;
      for (let attempt = 0; attempt < MAX_TASK_ATTEMPTS; attempt += 1) {
        const engOutcome = await engineeringAgentService.run({ agentId: params.engineeringAgentId, engineeringTaskId: current.id, startedBy: params.startedBy });
        if (engOutcome.status === "COMPLETED" && engOutcome.result.typecheckPassed) {
          current = engOutcome.result.task;
          succeeded = true;
          break;
        }
        const { task: recorded, retriesRemaining } = await engineeringTaskService.recordAttempt(current.id);
        current = recorded;
        if (!retriesRemaining) break;
      }
      if (!succeeded) return fail(`Engineering task "${task.title}" (${task.id}) did not complete within ${MAX_TASK_ATTEMPTS} attempt(s).`);
      completedTasks.push(current);
    }
    engineeringTasks = completedTasks;

    // REVIEWING
    product = await productService.setStatus(product.id, "REVIEWING", actor);
    for (const task of engineeringTasks) {
      await codeReviewAgentService.run({ agentId: params.codeReviewAgentId, engineeringTaskId: task.id, startedBy: params.startedBy });
    }

    // TESTING — QA + the mechanical Integration Test stage, same product status (§2's own mapping)
    product = await productService.setStatus(product.id, "TESTING", actor);
    for (const task of engineeringTasks) {
      await qaAgentService.run({ agentId: params.qaAgentId, engineeringTaskId: task.id, startedBy: params.startedBy });
    }
    await runIntegrationTest({ agentId: params.engineeringAgentId, workspacePath, startedBy: params.startedBy, tasks: engineeringTasks });

    // SECURITY_REVIEW
    product = await productService.setStatus(product.id, "SECURITY_REVIEW", actor);
    for (const task of engineeringTasks) {
      await securityReviewAgentService.run({ agentId: params.securityAgentId, engineeringTaskId: task.id, startedBy: params.startedBy });
    }

    // Cost intelligence + deployment preparation (docs/M6_ARCHITECTURE_PROPOSAL.md §25-26) — a plan and an
    // estimate only; nothing here spends money or touches production infrastructure.
    const design = fromJsonString<{ deploymentStrategy: string; externalDependencies: unknown[]; observability: { healthCheck: string } }>(mvpArchitecture.designJson, {
      deploymentStrategy: "(not specified)",
      externalDependencies: [],
      observability: { healthCheck: "(not specified)" },
    });
    const costEstimate = computeCostEstimate({ engineeringTaskCount: engineeringTasks.length, externalDependencyCount: design.externalDependencies.length });
    await productService.setCostEstimates(product.id, { estimatedDevelopmentCostUsd: costEstimate.estimatedDevelopmentCostUsd, estimatedOperatingCostUsd: costEstimate.estimatedOperatingCostUsd });
    await productService.setDeploymentArtifacts(product.id, {
      deploymentPlan: compileDeploymentPlan({ productName: productSpec.name, deploymentStrategy: design.deploymentStrategy, healthCheck: design.observability.healthCheck }),
      rollbackPlan: compileRollbackPlan({ productName: productSpec.name }),
    });

    // CEO recommendation, Chairman review, Memo compilation
    const ceoOutcome = await ceoReasoningService.recommendProductBuildAction({ agentId: params.ceoAgentId, productId: product.id, startedBy: params.startedBy });
    if (ceoOutcome.status !== "COMPLETED") return fail("CEO product-build recommendation did not complete.");
    const ceoRecommendation = ceoOutcome.result.recommendation;

    const { review: chairmanReview } = await chairmanService.reviewProduct({ productId: product.id, reviewedBy: params.startedBy });

    const memo = await productReviewMemoService.compile({
      productId: product.id,
      productSpec,
      mvpArchitecture,
      ceoRecommendation,
      chairmanReview,
      actor,
    });

    // HUMAN_REVIEW — the technical pipeline's own terminal state; a human decides from here (product-review-memo.service.ts's own recordHumanDecision).
    product = await productService.setStatus(product.id, "HUMAN_REVIEW", actor);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "PRODUCT_FACTORY_COMPLETED",
      resourceType: "PRODUCT",
      resourceId: product.id,
      result: "SUCCESS",
      metadata: { taskCount: engineeringTasks.length, ceoAction: ceoRecommendation.action, chairmanDecision: chairmanReview.decision, memoId: memo.id },
    });

    return { product, productSpec, mvpArchitecture, engineeringTasks, ceoRecommendation, chairmanReview, memo, stoppedReason: null };
  },
};

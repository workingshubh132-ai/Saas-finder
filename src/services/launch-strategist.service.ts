import type { DeploymentPlan, LaunchPlan, MvpArchitecture, Product } from "@prisma/client";
import { z } from "zod";
import { deploymentPlanRepository } from "../db/repositories/deployment-plan.repository.js";
import { launchPlanRepository } from "../db/repositories/launch-plan.repository.js";
import { mvpArchitectureRepository } from "../db/repositories/mvp-architecture.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { DEPLOYMENT_ENVIRONMENTS, type DeploymentEnvironment } from "../domain/deployment-plan/deployment-plan.types.js";
import { checkLaunchBudget } from "../domain/product/launch-budget.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { createDeploymentProvider } from "../providers/deployment-provider-factory.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 768;

/**
 * Zero tool calls (docs/M7_ARCHITECTURE_PROPOSAL.md §5, §17) — the
 * Launch Strategist only ever PLANS: it produces a DeploymentPlan row,
 * never calls a DeploymentProvider itself. Same shape as every M6
 * PLAN-only agent (Product Strategist/MVP Architect).
 */
export const LAUNCH_STRATEGIST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const launchStrategistOutputSchema = z.object({
  environment: z.enum(DEPLOYMENT_ENVIRONMENTS),
  strategy: z.string().min(1),
  rollbackPlan: z.string().min(1),
  reasoning: z.string().min(1),
});
type LaunchStrategistOutput = z.infer<typeof launchStrategistOutputSchema>;

const LAUNCH_STRATEGIST_SYSTEM_PROMPT =
  "You are the Launch Strategist for VentureForge (docs/M7_ARCHITECTURE_PROPOSAL.md §17). A Product has reached " +
  "READY_FOR_DEPLOYMENT — its engineering pipeline is complete. Propose a DEPLOYMENT PLAN, never a deployment: you " +
  "have no tools and cannot deploy, provision infrastructure, or spend anything yourself. Given the product's " +
  "architecture (deployment strategy, external dependencies, health check) and its own already-compiled rollback " +
  "notes, decide: environment (DEV, STAGING, or PRODUCTION — PRODUCTION is the normal choice once a human is about " +
  "to review a real go-live decision; this is a PLAN a human will separately approve, never an instruction to " +
  "actually deploy), strategy (concrete: how the deploy will actually happen, referencing the real architecture), " +
  "rollbackPlan (concrete: exactly how to undo this deploy if it fails), and reasoning. " +
  'Respond with ONLY JSON matching: {"environment": "DEV"|"STAGING"|"PRODUCTION", "strategy": string, ' +
  '"rollbackPlan": string, "reasoning": string}';

interface ArchitectureDesign {
  deploymentStrategy: string;
  externalDependencies: unknown[];
  observability: { healthCheck: string };
}

function buildLaunchStrategistPrompt(product: Product, spec: { name: string; targetCustomer: string; coreProblem: string } | null, design: ArchitectureDesign): string {
  return [
    `Product: ${spec?.name ?? product.id}`,
    spec ? `Target customer: ${spec.targetCustomer}` : "",
    spec ? `Core problem: ${spec.coreProblem}` : "",
    `Architecture deployment strategy (from the MVP Architect): ${design.deploymentStrategy}`,
    `External dependencies: ${design.externalDependencies.length}`,
    `Health check: ${design.observability.healthCheck}`,
    `Existing M6 rollback notes: ${product.rollbackPlan ?? "(none compiled)"}`,
    `Estimated monthly operating cost (M6 estimate): $${(product.estimatedOperatingCostUsd ?? 0).toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, derived from the product's own
 * real architecture/rollback text, never a static stub. Always
 * proposes PRODUCTION: this is the terminal step of the pipeline a
 * human is about to review for a real go-live decision, and a
 * PRODUCTION plan is never itself a deployment (§1).
 */
function buildDevLaunchStrategistFixture(product: Product, design: ArchitectureDesign): LaunchStrategistOutput {
  return {
    environment: "PRODUCTION",
    strategy: `[DEV FIXTURE] ${design.deploymentStrategy || "Deploy the workspace's built artifact behind the health check endpoint."} (${design.externalDependencies.length} external dependency/dependencies.)`,
    rollbackPlan: product.rollbackPlan ?? `[DEV FIXTURE] Roll back to the previous known-good deployment for this product; ${design.observability.healthCheck || "the health check"} must pass before considering the rollback complete.`,
    reasoning: "[DEV FIXTURE] Deterministic plan derived from the product's own real MVP architecture and M6 rollback notes.",
  };
}

export interface RunLaunchStrategistParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export interface LaunchStrategistResult {
  deploymentPlan: DeploymentPlan;
  launchPlan: LaunchPlan;
}

export const launchStrategistService = {
  async run(params: RunLaunchStrategistParams): Promise<RunOutcome<LaunchStrategistResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "READY_FOR_DEPLOYMENT" && product.status !== "LAUNCH_PLANNING") {
      throw new ValidationError(`Product ${product.id} is ${product.status} — the Launch Strategist only runs once a build is READY_FOR_DEPLOYMENT (or already LAUNCH_PLANNING).`);
    }
    const spec = await productSpecRepository.findLatestForProduct(product.id);
    const architecture: MvpArchitecture | null = await mvpArchitectureRepository.findLatestForProduct(product.id);
    const design = fromJsonString<ArchitectureDesign>(architecture?.designJson ?? "{}", {
      deploymentStrategy: "(not specified)",
      externalDependencies: [],
      observability: { healthCheck: "(not specified)" },
    });

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, launchStrategistOutputSchema, {
          systemPrompt: LAUNCH_STRATEGIST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildLaunchStrategistPrompt(product, spec, design) }],
          devFixtureResponse: buildDevLaunchStrategistFixture(product, design),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const estimatedMonthlyCostUsd = product.estimatedOperatingCostUsd ?? 0;
        const budgetCheck = checkLaunchBudget({ estimatedMonthlyCostUsd });

        const deploymentPlan = await deploymentPlanRepository.create({
          productId: product.id,
          environment: output.environment,
          provider: createDeploymentProvider().id,
          strategy: output.strategy,
          estimatedCostUsd: estimatedMonthlyCostUsd,
          rollbackPlan: output.rollbackPlan,
          artifactRef: product.workspacePath ?? product.id,
          budgetExceeded: budgetCheck.budgetExceeded,
        });

        const launchPlan = await launchPlanRepository.create({
          productId: product.id,
          deploymentPlanId: deploymentPlan.id,
          summary: toJsonString({
            deployment: { environment: deploymentPlan.environment, strategy: deploymentPlan.strategy, estimatedCostUsd: deploymentPlan.estimatedCostUsd, budgetExceeded: deploymentPlan.budgetExceeded, reasoning: output.reasoning },
            budget: budgetCheck,
          }),
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_DEPLOYMENT_PLAN",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { deploymentPlanId: deploymentPlan.id, launchPlanId: launchPlan.id, environment: deploymentPlan.environment, budgetExceeded: deploymentPlan.budgetExceeded },
        });

        return { deploymentPlan, launchPlan };
      },
      LAUNCH_STRATEGIST_BUDGET,
    );
  },
};

export type { DeploymentEnvironment };

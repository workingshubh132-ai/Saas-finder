import type { BillingPlan, DeploymentPlan, GrowthExperiment, OutreachMessage } from "@prisma/client";
import { computeResourceStateHash } from "./staleness.js";

/**
 * Per-resource-type field subsets for change detection
 * (docs/M9_ARCHITECTURE_PROPOSAL.md §39) — only the fields whose
 * change would materially affect whether the human's original
 * approval still applies. Each is a documented, deliberate choice,
 * not "every column" (createdAt/status/id churn on their own would
 * make every approval look stale).
 */
export function hashDeploymentPlan(plan: Pick<DeploymentPlan, "environment" | "provider" | "strategy" | "artifactRef">): string {
  return computeResourceStateHash({ environment: plan.environment, provider: plan.provider, strategy: plan.strategy, artifactRef: plan.artifactRef });
}

/**
 * `status` is deliberately excluded — DRAFT -> HUMAN_APPROVED is the
 * plan's own expected lifecycle between request-approval time and
 * execute time, not a sign the underlying business terms changed
 * (unlike DeploymentPlan/GrowthExperiment, this is a real bug this
 * build caught: an early version included status here and every
 * billing activation falsely tripped RESOURCE_CHANGED as a result).
 */
export function hashBillingPlan(plan: Pick<BillingPlan, "provider" | "pricingModelId">): string {
  return computeResourceStateHash({ provider: plan.provider, pricingModelId: plan.pricingModelId });
}

export function hashGrowthExperiment(experiment: Pick<GrowthExperiment, "hypothesis" | "estimatedCostUsd" | "riskLevel">): string {
  return computeResourceStateHash({ hypothesis: experiment.hypothesis, estimatedCostUsd: experiment.estimatedCostUsd, riskLevel: experiment.riskLevel });
}

/**
 * Autonomous Operations Phase A (docs/AUTONOMOUS_OPERATIONS_AUDIT.md) —
 * `OutreachMessage.content` is already immutable by construction (no
 * update method in outreach-message.repository.ts), so this can never
 * actually change after the human approved it; `prospectId` is
 * included anyway as the one field whose change genuinely would mean
 * "send this to someone else" — the exact scenario approval binding
 * exists to catch. `reasoning`/`experimentId`/`claimBeingTestedId`
 * excluded: none of them changes what gets sent to whom.
 */
export function hashOutreachMessage(message: Pick<OutreachMessage, "prospectId" | "content">): string {
  return computeResourceStateHash({ prospectId: message.prospectId, content: message.content });
}

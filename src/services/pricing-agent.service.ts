import type { Claim, PricingModel } from "@prisma/client";
import { z } from "zod";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { pricingModelRepository } from "../db/repositories/pricing-model.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeUnitEconomics, type UnitEconomics } from "../domain/pricing-model/unit-economics.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M7_ARCHITECTURE_PROPOSAL.md §21) — pure synthesis over already-persisted claims/evidence, same shape as productStrategistService. */
export const PRICING_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const pricingTierSchema = z.object({
  name: z.string().min(1),
  monthlyPriceUsd: z.number().min(0),
  features: z.array(z.string().min(1)).min(1),
});

const pricingOutputSchema = z.object({
  tiers: z.array(pricingTierSchema).min(1),
  estimatedCustomerCountForCostBasis: z.number().min(1),
  /** Never empty (§21) — every price point must cite a real willingness-to-pay (or related) claim. */
  groundedInClaimIds: z.array(z.string().min(1)).min(1),
  groundedInEvidenceIds: z.array(z.string()),
  reasoning: z.string().min(1),
});
type PricingOutput = z.infer<typeof pricingOutputSchema>;

const PRICING_AGENT_SYSTEM_PROMPT =
  "You are the Pricing Agent for VentureForge (docs/M7_ARCHITECTURE_PROPOSAL.md §21). Propose PRICING TIERS for a " +
  "product that is ready to launch — never activate billing yourself, you have no tools and cannot charge anyone. " +
  "You are given the opportunity's own claims (especially WILLINGNESS_TO_PAY, if any) and evidence — you MUST NOT " +
  "invent willingness to pay; every tier's price point must be grounded in a real claim id from the list given, " +
  "reported in groundedInClaimIds. A CONTRADICTED or WEAK willingness-to-pay claim should produce a lower, more " +
  "conservative price than a SUPPORTED one — never the same aggressive price regardless of evidence. Propose 1-3 " +
  "tiers, each with a name, a monthlyPriceUsd, and a short feature list. Also estimate " +
  "estimatedCustomerCountForCostBasis — a small, honest number of customers to assume when spreading the product's " +
  "own operating cost per customer (never a huge, unsupported number). " +
  'Respond with ONLY JSON matching: {"tiers": [{"name": string, "monthlyPriceUsd": number, "features": string[]}], ' +
  '"estimatedCustomerCountForCostBasis": number, "groundedInClaimIds": string[], "groundedInEvidenceIds": string[], "reasoning": string}';

function buildPricingPrompt(claims: readonly Claim[], evidence: readonly { id: string; claim: string; sourceType: string }[], operatingCostUsd: number): string {
  const claimLines = claims.map((c) => `- [id=${c.id}] [${c.claimType}] status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  const evidenceLines = evidence.slice(0, 15).map((e) => `- [id=${e.id}] (${e.sourceType}): ${e.claim}`);
  return [
    `Estimated monthly operating cost (M6 estimate): $${operatingCostUsd.toFixed(2)}`,
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none)"]),
    "",
    `Evidence (${evidence.length}${evidence.length > 15 ? ", showing first 15" : ""}):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, derived from the opportunity's own
 * real WILLINGNESS_TO_PAY claim (when one exists), never a static
 * stub: a SUPPORTED claim justifies a standard price, anything weaker
 * justifies a conservative one.
 */
function buildDevPricingFixture(claims: readonly Claim[]): PricingOutput {
  const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY");
  const fallbackClaim = claims[0];
  const groundingClaim = wtpClaim ?? fallbackClaim;
  if (!groundingClaim) {
    throw new ValidationError("Cannot propose pricing for an opportunity with no claims — run claim extraction first.");
  }
  const supported = wtpClaim?.status === "SUPPORTED";
  const basePriceUsd = supported ? 49 : 19;

  return {
    tiers: [
      { name: "Starter", monthlyPriceUsd: basePriceUsd, features: ["Core workflow access"] },
      { name: "Pro", monthlyPriceUsd: basePriceUsd * 2, features: ["Core workflow access", "Priority support"] },
    ],
    estimatedCustomerCountForCostBasis: 10,
    groundedInClaimIds: [groundingClaim.id],
    groundedInEvidenceIds: [],
    reasoning: wtpClaim
      ? `[DEV FIXTURE] willingness-to-pay claim [id=${wtpClaim.id}] is ${wtpClaim.status} — ${supported ? "a standard" : "a conservative"} starting price point is justified.`
      : `[DEV FIXTURE] No willingness-to-pay claim exists yet — falling back to the most relevant available claim [id=${groundingClaim.id}] and a conservative price point.`,
  };
}

export interface RunPricingAgentParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export interface PricingAgentResult {
  pricingModel: PricingModel;
  unitEconomics: UnitEconomics;
}

export const pricingAgentService = {
  async run(params: RunPricingAgentParams): Promise<RunOutcome<PricingAgentResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    const opportunity = await opportunityRepository.findById(product.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", product.opportunityId);

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
        const claims = await claimRepository.listForOpportunity(product.opportunityId);
        const evidence = await opportunityRepository.listEvidence(product.opportunityId);
        const validClaimIds = new Set(claims.map((c) => c.id));
        const validEvidenceIds = new Set(evidence.map((e) => e.id));
        const operatingCostUsd = product.estimatedOperatingCostUsd ?? 0;

        const { value: output } = await completeWithValidation(handle.callModel, pricingOutputSchema, {
          systemPrompt: PRICING_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildPricingPrompt(claims, evidence, operatingCostUsd) }],
          devFixtureResponse: buildDevPricingFixture(claims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust the model's own citation on faith (§21) — every grounded id must be real.
        const groundedClaimIds = output.groundedInClaimIds.filter((id) => validClaimIds.has(id));
        if (groundedClaimIds.length === 0) {
          throw new ValidationError("Pricing Agent produced no real, verifiable claim citations — refusing to persist an ungrounded pricing model.");
        }
        const groundedEvidenceIds = output.groundedInEvidenceIds.filter((id) => validEvidenceIds.has(id));

        const [primaryTier] = output.tiers;
        if (!primaryTier) {
          throw new ValidationError("Pricing Agent proposed no tiers.");
        }
        const unitEconomics = computeUnitEconomics({
          monthlyPriceUsd: primaryTier.monthlyPriceUsd,
          estimatedOperatingCostUsdPerMonth: operatingCostUsd,
          estimatedCustomerCountForCostBasis: output.estimatedCustomerCountForCostBasis,
        });

        const pricingModel = await pricingModelRepository.create({
          productId: product.id,
          tiers: toJsonString(output.tiers),
          unitEconomics: toJsonString(unitEconomics),
          groundedInClaimIds: toJsonString(groundedClaimIds),
          groundedInEvidenceIds: toJsonString(groundedEvidenceIds),
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_PRICING_MODEL",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { pricingModelId: pricingModel.id, tierCount: output.tiers.length, grossMarginPct: unitEconomics.grossMarginPct },
        });

        return { pricingModel, unitEconomics };
      },
      PRICING_AGENT_BUDGET,
    );
  },
};

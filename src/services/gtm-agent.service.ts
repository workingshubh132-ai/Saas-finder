import type { Claim, GoToMarketPlan } from "@prisma/client";
import { z } from "zod";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { goToMarketPlanRepository } from "../db/repositories/go-to-market-plan.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M7_ARCHITECTURE_PROPOSAL.md §22) — a plan and a spec only; no route anywhere in this codebase can publish or send anything on the GTM Agent's behalf. */
export const GTM_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const channelSchema = z.object({
  channel: z.string().min(1),
  reasoning: z.string().min(1),
});

const experimentSchema = z.object({
  name: z.string().min(1),
  channel: z.string().min(1),
  hypothesis: z.string().min(1),
  successCriteria: z.string().min(1),
});

const landingPageSpecSchema = z.object({
  headline: z.string().min(1),
  subheadline: z.string().min(1),
  sections: z.array(z.string().min(1)).min(1),
  callToAction: z.string().min(1),
});

const gtmOutputSchema = z.object({
  channels: z.array(channelSchema).min(1),
  landingPageSpec: landingPageSpecSchema,
  experiments: z.array(experimentSchema).min(1),
  /** Never empty (§22) — every proposed channel must cite a real claim about the target customer/problem. */
  groundedInClaimIds: z.array(z.string().min(1)).min(1),
});
type GtmOutput = z.infer<typeof gtmOutputSchema>;

const GTM_AGENT_SYSTEM_PROMPT =
  "You are the Go-To-Market Agent for VentureForge (docs/M7_ARCHITECTURE_PROPOSAL.md §22). Produce a GTM PLAN and " +
  "a landing-page SPEC — never an actual campaign, publish, or send. You have no tools and cannot post content, buy " +
  "ads, or contact anyone. Given the product's own target customer/core problem and the opportunity's claims, " +
  "propose 1-3 candidate distribution channels — each with a real reasoning grounded in a specific claim id, never " +
  "a generic 'social media' with no justification. Propose a landing-page SPEC (headline, subheadline, sections, " +
  "call to action) describing what the page should say, never actual HTML or a real deploy. Propose 1-2 " +
  "acquisition-EXPERIMENT specs (name, channel, hypothesis, successCriteria) the CEO could later recommend running " +
  "— never a real experiment itself. " +
  'Respond with ONLY JSON matching: {"channels": [{"channel": string, "reasoning": string}], "landingPageSpec": ' +
  '{"headline": string, "subheadline": string, "sections": string[], "callToAction": string}, "experiments": ' +
  '[{"name": string, "channel": string, "hypothesis": string, "successCriteria": string}], "groundedInClaimIds": string[]}';

function buildGtmPrompt(spec: { name: string; targetCustomer: string; coreProblem: string } | null, claims: readonly Claim[]): string {
  const claimLines = claims.map((c) => `- [id=${c.id}] [${c.claimType}] status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  return [
    spec ? `Product: ${spec.name}` : "",
    spec ? `Target customer: ${spec.targetCustomer}` : "",
    spec ? `Core problem: ${spec.coreProblem}` : "",
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none)"]),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * DEVELOPMENT ONLY — deterministic, derived from the product's own
 * real target customer/core problem and a real CUSTOMER_SEGMENT claim
 * when one exists, never a static stub.
 */
function buildDevGtmFixture(spec: { name: string; targetCustomer: string; coreProblem: string } | null, claims: readonly Claim[]): GtmOutput {
  const segmentClaim = claims.find((c) => c.claimType === "CUSTOMER_SEGMENT") ?? claims[0];
  if (!segmentClaim) {
    throw new ValidationError("Cannot propose a GTM plan for an opportunity with no claims — run claim extraction first.");
  }
  const targetCustomer = spec?.targetCustomer ?? "the target customer";
  const coreProblem = spec?.coreProblem ?? "the core problem";

  return {
    channels: [
      { channel: "Direct outreach to the validated customer segment", reasoning: `[DEV FIXTURE] Claim [id=${segmentClaim.id}] (${segmentClaim.status}) already identifies this segment — the same channel customer discovery used, now for acquisition.` },
      { channel: "Community/forum where this segment already discusses the problem", reasoning: `[DEV FIXTURE] Grounded in claim [id=${segmentClaim.id}]'s own description of ${targetCustomer}.` },
    ],
    landingPageSpec: {
      headline: `For ${targetCustomer}: solve "${coreProblem}"`,
      subheadline: spec?.name ?? "A focused tool for one real workflow.",
      sections: ["Problem statement", "How it works (the one core workflow)", "Pricing", "Call to action"],
      callToAction: "Start now",
    },
    experiments: [
      {
        name: "Landing page conversion test",
        channel: "Direct outreach to the validated customer segment",
        hypothesis: `${targetCustomer} will sign up when the page names their real problem directly.`,
        successCriteria: "A measurable click-through-to-signup rate on the landing page, tracked as an ESTIMATED metric until real traffic exists.",
      },
    ],
    groundedInClaimIds: [segmentClaim.id],
  };
}

export interface RunGtmAgentParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export interface GtmAgentResult {
  goToMarketPlan: GoToMarketPlan;
}

export const gtmAgentService = {
  async run(params: RunGtmAgentParams): Promise<RunOutcome<GtmAgentResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    const opportunity = await opportunityRepository.findById(product.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", product.opportunityId);
    const spec = await productSpecRepository.findLatestForProduct(product.id);

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
        const validClaimIds = new Set(claims.map((c) => c.id));

        const { value: output } = await completeWithValidation(handle.callModel, gtmOutputSchema, {
          systemPrompt: GTM_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildGtmPrompt(spec, claims) }],
          devFixtureResponse: buildDevGtmFixture(spec, claims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const groundedClaimIds = output.groundedInClaimIds.filter((id) => validClaimIds.has(id));
        if (groundedClaimIds.length === 0) {
          throw new ValidationError("GTM Agent produced no real, verifiable claim citations — refusing to persist an ungrounded plan.");
        }

        const goToMarketPlan = await goToMarketPlanRepository.create({
          productId: product.id,
          channels: toJsonString(output.channels),
          landingPageSpec: toJsonString(output.landingPageSpec),
          experiments: toJsonString(output.experiments),
          groundedInClaimIds: toJsonString(groundedClaimIds),
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_GO_TO_MARKET_PLAN",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { goToMarketPlanId: goToMarketPlan.id, channelCount: output.channels.length },
        });

        return { goToMarketPlan };
      },
      GTM_AGENT_BUDGET,
    );
  },
};

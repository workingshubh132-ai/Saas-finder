import type { MvpArchitecture, ProductSpec } from "@prisma/client";
import { z } from "zod";
import { mvpArchitectureRepository } from "../db/repositories/mvp-architecture.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §9) — pure synthesis over the just-created MvpArchitecture. */
export const UX_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const screenSchema = z.object({
  name: z.string().min(1),
  /** The real MVP workflow this screen maps to — never a decorative screen (§9). */
  mapsToWorkflow: z.string().min(1),
  purpose: z.string().min(1),
  emptyState: z.string().min(1),
  loadingState: z.string().min(1),
  errorState: z.string().min(1),
  successState: z.string().min(1),
});

const uxOutputSchema = z.object({
  personas: z.array(z.object({ name: z.string().min(1), description: z.string().min(1) })).min(1),
  journeys: z.array(z.string().min(1)).min(1),
  screens: z.array(screenSchema).min(1),
  navigation: z.string().min(1),
  forms: z.array(z.object({ name: z.string().min(1), fields: z.array(z.string().min(1)) })),
  accessibility: z.array(z.string().min(1)),
});
type UxOutput = z.infer<typeof uxOutputSchema>;

const UX_AGENT_SYSTEM_PROMPT =
  "You are the UX Agent for VentureForge (docs/M6_ARCHITECTURE_PROPOSAL.md §9). Turn the given product " +
  "specification and technical architecture into the SMALLEST usable user experience — never decorative screens. " +
  "Every screen you propose must map to an actual MVP workflow already named in the architecture's own APIs/core " +
  "entities; do not invent a screen with no corresponding backend capability. For each screen report its empty, " +
  "loading, error, and success states explicitly — never leave one unconsidered. " +
  'Respond with ONLY JSON matching: {"personas": [{"name": string, "description": string}], "journeys": string[], ' +
  '"screens": [{"name": string, "mapsToWorkflow": string, "purpose": string, "emptyState": string, "loadingState": ' +
  'string, "errorState": string, "successState": string}], "navigation": string, "forms": [{"name": string, ' +
  '"fields": string[]}], "accessibility": string[]}';

export interface RunUxAgentParams {
  agentId: string;
  mvpArchitectureId: string;
  startedBy: AuthenticatedActor;
}

export interface UxAgentResult {
  mvpArchitecture: MvpArchitecture;
}

interface ParsedDesign {
  apis: Array<{ method: string; path: string; purpose: string }>;
  coreEntities: Array<{ name: string; fields: string[] }>;
  ux: UxOutput | null;
}

function buildUxPrompt(spec: ProductSpec, design: ParsedDesign): string {
  const apiLines = design.apis.map((a) => `- ${a.method} ${a.path} — ${a.purpose}`);
  const entityLines = design.coreEntities.map((e) => `- ${e.name}: ${e.fields.join(", ")}`);
  return [
    `Product: ${spec.name}`,
    `Target customer: ${spec.targetCustomer}`,
    `Core workflow: ${spec.coreWorkflow}`,
    "",
    `APIs (${design.apis.length}):`,
    ...(apiLines.length > 0 ? apiLines : ["(none)"]),
    "",
    `Core entities (${design.coreEntities.length}):`,
    ...(entityLines.length > 0 ? entityLines : ["(none)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — genuinely derived from the real architecture's
 * own APIs/entities, never a static stub: one screen per API surface
 * actually present, each explicitly naming which real workflow it
 * maps to.
 */
function buildDevUxFixture(spec: ProductSpec, design: ParsedDesign): UxOutput {
  const entity = design.coreEntities[0]?.name ?? "record";
  const createApi = design.apis.find((a) => a.method === "POST");
  const listApi = design.apis.find((a) => a.method === "GET" && a.path !== "/health");

  const screens = [];
  if (createApi) {
    screens.push({
      name: `New ${entity}`,
      mapsToWorkflow: spec.coreWorkflow,
      purpose: `Let ${spec.targetCustomer} record one ${entity}.`,
      emptyState: "A blank form with a short prompt explaining what to enter.",
      loadingState: "The submit button shows a spinner and disables itself while the request is in flight.",
      errorState: "A clear inline message naming what was wrong with the submission — never a raw error code alone.",
      successState: `Confirmation the ${entity} was saved, then navigation to the list screen.`,
    });
  }
  if (listApi) {
    screens.push({
      name: `${entity} list`,
      mapsToWorkflow: spec.coreWorkflow,
      purpose: `Let ${spec.targetCustomer} see every ${entity} recorded so far.`,
      emptyState: `"No ${entity} yet" with a prompt to create the first one.`,
      loadingState: "A skeleton placeholder while the list loads.",
      errorState: "A retry affordance if the list fails to load.",
      successState: `The real list of ${entity} records, newest first.`,
    });
  }
  if (screens.length === 0) {
    throw new ValidationError("Cannot produce a UX design with zero API surfaces to map screens onto.");
  }

  return {
    personas: [{ name: spec.targetCustomer, description: `The real target customer this MVP is being built to test: ${spec.coreProblem}` }],
    journeys: [`${spec.targetCustomer} opens the app -> creates a new ${entity} -> sees it appear in the list.`],
    screens,
    navigation: `Two screens only: "${entity} list" (the default view) and "New ${entity}" (reached via a single, obvious action).`,
    forms: createApi ? [{ name: `New ${entity} form`, fields: ["notes"] }] : [],
    accessibility: ["Every form field has a real, visible label.", "Every interactive element is reachable and operable by keyboard alone.", "Color is never the only signal for an error or success state."],
  };
}

/**
 * The UX Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §9) — the one
 * legitimate follow-up write to an MvpArchitecture row the MVP
 * Architect already created: fills in exactly the `ux` field, once.
 */
export const uxAgentService = {
  async run(params: RunUxAgentParams): Promise<RunOutcome<UxAgentResult>> {
    const architecture = await mvpArchitectureRepository.findById(params.mvpArchitectureId);
    if (!architecture) throw new NotFoundError("MvpArchitecture", params.mvpArchitectureId);
    const spec = await productSpecRepository.findById(architecture.productSpecId);
    if (!spec) throw new NotFoundError("ProductSpec", architecture.productSpecId);

    const design = fromJsonString<ParsedDesign>(architecture.designJson, { apis: [], coreEntities: [], ux: null });
    if (design.ux !== null) {
      throw new ValidationError(`MvpArchitecture ${architecture.id} already has a UX design — the UX Agent runs exactly once per architecture.`);
    }

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { mvpArchitectureId: params.mvpArchitectureId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, uxOutputSchema, {
          systemPrompt: UX_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildUxPrompt(spec, design) }],
          devFixtureResponse: buildDevUxFixture(spec, design),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const updated = await mvpArchitectureRepository.setDesignJson(architecture.id, toJsonString({ ...design, ux: output }));

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "SET_MVP_ARCHITECTURE_UX",
          resourceType: "PRODUCT",
          resourceId: architecture.productId,
          result: "SUCCESS",
          metadata: { mvpArchitectureId: architecture.id, screenCount: output.screens.length },
        });

        return { mvpArchitecture: updated };
      },
      UX_AGENT_BUDGET,
    );
  },
};

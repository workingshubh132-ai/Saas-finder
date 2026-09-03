import type { Feature, MvpArchitecture, ProductSpec } from "@prisma/client";
import { z } from "zod";
import { featureRepository } from "../db/repositories/feature.repository.js";
import { mvpArchitectureRepository } from "../db/repositories/mvp-architecture.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1536;

/** Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §8) — pure design synthesis over an already-persisted ProductSpec. */
export const MVP_ARCHITECT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const TIERS = ["MUST_HAVE", "SHOULD_HAVE", "DEFERRED"] as const;

const componentSchema = z.object({
  choice: z.string().min(1),
  tier: z.enum(TIERS),
  /** Required for every MUST_HAVE (§8's own "why this database/framework/dependency/infrastructure" requirement) — never empty. */
  justification: z.string().min(1),
});

const architectOutputSchema = z.object({
  frontend: componentSchema,
  backend: componentSchema,
  database: componentSchema,
  authentication: componentSchema,
  authorization: componentSchema,
  externalDependencies: z.array(z.object({ name: z.string().min(1), purpose: z.string().min(1), tier: z.enum(TIERS), justification: z.string().min(1) })),
  apis: z.array(z.object({ method: z.string().min(1), path: z.string().min(1), purpose: z.string().min(1) })),
  coreEntities: z.array(z.object({ name: z.string().min(1), fields: z.array(z.string().min(1)) })),
  dataFlows: z.array(z.string().min(1)),
  errorHandling: z.string().min(1),
  testingStrategy: z.string().min(1),
  securityStrategy: z.string().min(1),
  deploymentStrategy: z.string().min(1),
  observability: z.object({ logs: z.string().min(1), metrics: z.array(z.string().min(1)), healthCheck: z.string().min(1) }),
});
type ArchitectOutput = z.infer<typeof architectOutputSchema>;

const MVP_ARCHITECT_SYSTEM_PROMPT =
  "You are the MVP Architect for VentureForge (docs/M6_ARCHITECTURE_PROPOSAL.md §8-9). Convert the given product " +
  "specification and its BUILD_NOW features into a technical design for the SMALLEST technically credible product " +
  "— never introduce microservices, Kubernetes, message queues, event buses, distributed workers, or vector " +
  "databases unless the spec's own workflow genuinely requires them; a small SaaS is allowed to stay small. Every " +
  "MUST_HAVE component requires a real, specific justification answering 'why this database/framework/dependency/" +
  "infrastructure' — never a generic platitude. Tag every component MUST_HAVE, SHOULD_HAVE, or DEFERRED. Prefer " +
  "reusing a plain, proven stack (TypeScript/Express/SQLite) unless the spec's own content genuinely calls for " +
  "something else. " +
  'Respond with ONLY JSON matching: {"frontend": {...}, "backend": {...}, "database": {...}, "authentication": ' +
  '{...}, "authorization": {...}, "externalDependencies": [{"name": string, "purpose": string, "tier": string, ' +
  '"justification": string}], "apis": [{"method": string, "path": string, "purpose": string}], "coreEntities": ' +
  '[{"name": string, "fields": string[]}], "dataFlows": string[], "errorHandling": string, "testingStrategy": ' +
  'string, "securityStrategy": string, "deploymentStrategy": string, "observability": {"logs": string, "metrics": ' +
  'string[], "healthCheck": string}} where each {...} component is {"choice": string, "tier": "MUST_HAVE"|' +
  '"SHOULD_HAVE"|"DEFERRED", "justification": string}';

export interface RunMvpArchitectParams {
  agentId: string;
  productSpecId: string;
  startedBy: AuthenticatedActor;
}

export interface MvpArchitectResult {
  mvpArchitecture: MvpArchitecture;
}

function buildArchitectPrompt(spec: ProductSpec, features: readonly Feature[]): string {
  const featureLines = features.map((f) => `- [id=${f.id}] ${f.description} (priority=${f.priority}, score=${f.score.toFixed(2)})`);
  return [
    `Product: ${spec.name}`,
    `Target customer: ${spec.targetCustomer}`,
    `Core problem: ${spec.coreProblem}`,
    `Core workflow: ${spec.coreWorkflow}`,
    "",
    `BUILD_NOW features (${features.length}):`,
    ...(featureLines.length > 0 ? featureLines : ["(none — the MVP boundary is the core workflow alone)"]),
  ].join("\n");
}

/** Derives a short, safe, lowercase identifier from free text — never invents a name unrelated to the real spec. */
function slugFromText(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  return (words[0] ?? "record").slice(0, 24);
}

/**
 * DEVELOPMENT ONLY — genuinely derived from the real ProductSpec text,
 * never a static stub: the entity name and API path come from the
 * spec's own coreWorkflow, and authentication is only MUST_HAVE when
 * the spec's own text actually signals per-user data. Backend defaults
 * to VentureForge's own proven stack (TypeScript/Express) — the honest
 * "why this framework" answer for a tiny MVP is "the same engine this
 * very system already trusts." Database deliberately defaults to an
 * in-process store, not SQLite/Prisma: a second Prisma schema would
 * need its own `prisma generate` (a real, potentially network-dependent
 * engine-binary fetch this sandboxed environment cannot guarantee),
 * and the brief's own "smallest technically credible product" standard
 * does not require real persistence to prove a core workflow — it is
 * named explicitly as a SHOULD_HAVE, not silently skipped.
 */
function buildDevArchitectFixture(spec: ProductSpec): ArchitectOutput {
  const entityName = slugFromText(spec.coreWorkflow || spec.name);
  const needsAuth = /\b(account|login|user profile|per-user|sign ?up|sign ?in)\b/i.test(`${spec.coreWorkflow} ${spec.name}`);

  return {
    frontend: { choice: "Server-rendered JSON API only, no separate frontend framework", tier: "MUST_HAVE", justification: "The MVP's only job is to prove the core workflow works — a UI framework adds surface area this thesis test does not need yet." },
    backend: { choice: "Express (Node.js/TypeScript)", tier: "MUST_HAVE", justification: "The same stack VentureForge itself already runs and trusts — zero new tooling to learn or audit for a product this small." },
    database: { choice: "In-process store (a single module-level array), no separate database engine", tier: "MUST_HAVE", justification: "Proves the core workflow without a second, independently-provisioned database engine — real persistence (SQLite via Prisma, the same engine VentureForge itself trusts) is the natural next step once the workflow itself is validated, not before." },
    authentication: needsAuth
      ? { choice: "A single shared dev-only bearer token (no real user accounts yet)", tier: "MUST_HAVE", justification: "The spec's own workflow text implies per-user data — some minimal authentication boundary is needed even at MVP scale." }
      : { choice: "None", tier: "DEFERRED", justification: "This MVP demonstrates one core workflow with no per-user data — real authentication would be effort spent proving nothing the current thesis needs." },
    authorization: { choice: "None", tier: "DEFERRED", justification: "No authentication exists yet to authorize against; deferred alongside it." },
    externalDependencies: [
      { name: "SQLite via Prisma", purpose: "Durable persistence once the in-process store has proven the workflow is worth keeping.", tier: "SHOULD_HAVE", justification: "The natural, low-risk next step (same engine VentureForge itself already runs) — deferred only because an in-process store already proves the workflow without a second database engine to provision." },
    ],
    apis: [
      { method: "GET", path: "/health", purpose: "Observability — confirms the service is running (§26)." },
      { method: "POST", path: `/api/${entityName}`, purpose: `Create one ${entityName} — the core workflow's own write path.` },
      { method: "GET", path: `/api/${entityName}`, purpose: `List ${entityName} records — the core workflow's own read path.` },
    ],
    coreEntities: [{ name: entityName, fields: ["id", "createdAt", "notes"] }],
    dataFlows: [`Client -> POST /api/${entityName} -> in-process store`, `Client -> GET /api/${entityName} -> in-process store -> JSON response`],
    errorHandling: "Every route wraps its handler in a try/catch returning a structured {error} JSON body with an appropriate HTTP status — never an unhandled exception reaching the client.",
    testingStrategy: `Real, executable tests: one test creating a ${entityName} and asserting it round-trips through GET, one test asserting a malformed POST body is rejected with 400.`,
    securityStrategy: "Input validated with a schema library before touching the store; no secrets in source; every response is JSON, never raw string interpolation of user input.",
    deploymentStrategy: "A deployment PLAN only (docs/M6_ARCHITECTURE_PROPOSAL.md §25) — this milestone never deploys autonomously.",
    observability: { logs: "One structured log line per request (method, path, status, duration).", metrics: ["request_count", "error_count"], healthCheck: "GET /health returns 200 with {status: \"ok\"}." },
  } satisfies ArchitectOutput;
}

/**
 * The MVP Architect (docs/M6_ARCHITECTURE_PROPOSAL.md §8-9) — converts
 * a ProductSpec into a technical design, historized like ProductSpec
 * itself. `ux` starts null; the UX Agent (mvp-architect.service.ts's
 * sibling, ux-agent.service.ts) fills it in with exactly one
 * subsequent update, mirroring CustomerDiscoveryMemo's own
 * "starts incomplete, completed by exactly one later call" shape.
 */
export const mvpArchitectService = {
  async run(params: RunMvpArchitectParams): Promise<RunOutcome<MvpArchitectResult>> {
    const spec = await productSpecRepository.findById(params.productSpecId);
    if (!spec) throw new NotFoundError("ProductSpec", params.productSpecId);
    const product = await productRepository.findById(spec.productId);
    if (!product) throw new NotFoundError("Product", spec.productId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productSpecId: params.productSpecId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const features = await featureRepository.listBuildNowForProductSpec(spec.id);

        const { value: output } = await completeWithValidation(handle.callModel, architectOutputSchema, {
          systemPrompt: MVP_ARCHITECT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildArchitectPrompt(spec, features) }],
          devFixtureResponse: buildDevArchitectFixture(spec),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const mvpArchitecture = await mvpArchitectureRepository.create({
          productId: product.id,
          productSpecId: spec.id,
          designJson: toJsonString({ ...output, ux: null }),
          generatedByAgentId: params.agentId,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_MVP_ARCHITECTURE",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { mvpArchitectureId: mvpArchitecture.id },
        });
        await eventBus.publish({ type: "MVP_ARCHITECTURE_CREATED", payload: { mvpArchitectureId: mvpArchitecture.id, productId: product.id } });

        return { mvpArchitecture };
      },
      MVP_ARCHITECT_BUDGET,
    );
  },
};

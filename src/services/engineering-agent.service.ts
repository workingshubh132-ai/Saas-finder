import { readFile } from "node:fs/promises";
import type { EngineeringTask } from "@prisma/client";
import { z } from "zod";
import { engineeringTaskRepository } from "../db/repositories/engineering-task.repository.js";
import { mvpArchitectureRepository } from "../db/repositories/mvp-architecture.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { checkDependencies } from "../domain/workspace/dependency-policy.js";
import { resolveWorkspacePath } from "../domain/workspace/workspace-path.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { engineeringTaskService } from "./engineering-task.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 2048;

/**
 * One model call, a handful of GREEN workspace tool calls, one real
 * subprocess typecheck (docs/M6_ARCHITECTURE_PROPOSAL.md §11, §13) —
 * generous maxDurationMs because `tsc` is a real subprocess, not a
 * mocked call.
 */
export const ENGINEERING_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 10,
  maxToolCalls: 6,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 60_000,
};

const fileWriteSchema = z.object({
  /** Must be one of this task's own allowedFiles — checked against real data, never trusted from the model alone (§12). */
  relativePath: z.string().min(1),
  content: z.string().min(1),
});

const indexMountSchema = z.object({
  /** A single, complete `import ... from "./routes.js";` line — spliced in deterministically, never model-authored full-file surgery on the shared scaffold (§11). */
  importLine: z.string().min(1),
  /** A single, complete `app.use(...)` line. */
  mountLine: z.string().min(1),
});

const engineeringOutputSchema = z.object({
  files: z.array(fileWriteSchema).min(1),
  /** Non-null only for a task whose allowedFiles include src/index.ts. */
  indexMount: indexMountSchema.nullable(),
  implementationSummary: z.string().min(1),
  knownLimitations: z.array(z.string()),
});
type EngineeringOutput = z.infer<typeof engineeringOutputSchema>;

interface EntityInfo {
  name: string;
  fields: string[];
}

interface ParsedDesign {
  coreEntities: EntityInfo[];
}

export interface RunEngineeringAgentParams {
  agentId: string;
  engineeringTaskId: string;
  startedBy: AuthenticatedActor;
}

export interface EngineeringAgentResult {
  task: EngineeringTask;
  typecheckPassed: boolean;
  typecheckOutput: string;
  filesWritten: string[];
}

const ENGINEERING_AGENT_SYSTEM_PROMPT =
  "You are the Engineering Agent for VentureForge's SaaS Factory (docs/M6_ARCHITECTURE_PROPOSAL.md §11-13). You " +
  "implement exactly ONE EngineeringTask inside an isolated, disposable workspace directory — never anything " +
  "outside the task's own allowedFiles list. Write plain, small, real TypeScript (Express, no new dependencies " +
  "beyond what the workspace already has unless the task genuinely requires one) satisfying every listed " +
  "acceptance criterion and including every required test, written as real, runnable vitest tests — never a stub " +
  "or a TODO. If, and only if, src/index.ts is in this task's allowedFiles, you do not rewrite that file yourself " +
  "— instead report exactly one import line and one app.use(...) mount line to splice into it, since it is a " +
  "shared scaffold other work also depends on. " +
  'Respond with ONLY JSON matching: {"files": [{"relativePath": string, "content": string}], "indexMount": ' +
  '{"importLine": string, "mountLine": string} | null, "implementationSummary": string, "knownLimitations": ' +
  "string[]}";

function buildEngineeringPrompt(task: EngineeringTask, entity: EntityInfo, allowedFiles: readonly string[], currentIndexContent: string | null): string {
  const acceptanceCriteria: string[] = fromJsonString(task.acceptanceCriteria, []);
  const testsRequired: string[] = fromJsonString(task.testsRequired, []);
  return [
    `Task: ${task.title}`,
    `Purpose: ${task.purpose}`,
    `Allowed files (write ONLY these): ${allowedFiles.join(", ")}`,
    `Core entity: ${entity.name} (fields: ${entity.fields.join(", ")})`,
    "",
    "Acceptance criteria:",
    ...acceptanceCriteria.map((c) => `- ${c}`),
    "",
    "Tests required:",
    ...testsRequired.map((t) => `- ${t}`),
    ...(currentIndexContent !== null ? ["", "Current src/index.ts content (for context only — report a splice, do not rewrite it):", currentIndexContent] : []),
  ].join("\n");
}

function buildStoreFileContent(dataFields: readonly string[]): string {
  const fieldsType = dataFields.map((f) => `  ${f}: string;`).join("\n");
  const createParamsType = dataFields.map((f) => `${f}: string`).join("; ");
  return [
    "// [DEV FIXTURE] Generated by the Engineering Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §11).",
    "export interface StoreItem {",
    "  id: string;",
    "  createdAt: string;",
    fieldsType,
    "}",
    "",
    "const records: StoreItem[] = [];",
    "let nextId = 1;",
    "",
    `export function create(fields: { ${createParamsType} }): StoreItem {`,
    "  const record: StoreItem = { id: String(nextId), createdAt: new Date().toISOString(), ...fields };",
    "  nextId += 1;",
    "  records.unshift(record);",
    "  return record;",
    "}",
    "",
    "export function list(): StoreItem[] {",
    "  return [...records];",
    "}",
    "",
  ].join("\n");
}

function buildStoreTestFileContent(entityName: string, dataFields: readonly string[]): string {
  const sampleObject = dataFields.map((f) => `${f}: "test value"`).join(", ");
  return [
    'import { describe, expect, it } from "vitest";',
    'import { create, list } from "../src/store.js";',
    "",
    `describe("${entityName} store", () => {`,
    '  it("creates a record and returns it from list()", () => {',
    `    const created = create({ ${sampleObject} });`,
    "    expect(created.id).toBeTruthy();",
    "    const all = list();",
    "    expect(all.some((r) => r.id === created.id)).toBe(true);",
    "  });",
    "});",
    "",
  ].join("\n");
}

function buildRoutesFileContent(entityName: string, dataFields: readonly string[]): string {
  const guardChecks = dataFields.map((f) => `typeof record.${f} === "string" && record.${f}.length > 0`).join(" && ");
  const paramsType = dataFields.map((f) => `${f}: string`).join("; ");
  return [
    "// [DEV FIXTURE] Generated by the Engineering Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §11).",
    'import { Router } from "express";',
    'import { create, list } from "./store.js";',
    "",
    `export const ${entityName}Router = Router();`,
    "",
    `function isValidBody(body: unknown): body is { ${paramsType} } {`,
    '  if (typeof body !== "object" || body === null) return false;',
    "  const record = body as Record<string, unknown>;",
    `  return ${guardChecks};`,
    "}",
    "",
    `${entityName}Router.post("/", (req, res) => {`,
    "  if (!isValidBody(req.body)) {",
    '    res.status(400).json({ error: "Invalid request body" });',
    "    return;",
    "  }",
    "  const record = create(req.body);",
    "  res.status(201).json(record);",
    "});",
    "",
    `${entityName}Router.get("/", (_req, res) => {`,
    "  res.status(200).json(list());",
    "});",
    "",
  ].join("\n");
}

function buildRoutesTestFileContent(entityName: string, dataFields: readonly string[]): string {
  const sampleObject = dataFields.map((f) => `${f}: "test value"`).join(", ");
  return [
    'import { describe, expect, it } from "vitest";',
    'import { createApp } from "../src/index.js";',
    "",
    "async function listen() {",
    "  const app = createApp();",
    "  const server = app.listen(0);",
    "  const address = server.address();",
    '  const port = typeof address === "object" && address ? address.port : 0;',
    '  return { server, base: "http://127.0.0.1:" + port };',
    "}",
    "",
    `describe("${entityName} API", () => {`,
    '  it("creates a record via POST and returns it from GET", async () => {',
    "    const { server, base } = await listen();",
    `    const postRes = await fetch(base + "/api/${entityName}", {`,
    '      method: "POST",',
    '      headers: { "content-type": "application/json" },',
    `      body: JSON.stringify({ ${sampleObject} }),`,
    "    });",
    "    expect(postRes.status).toBe(201);",
    "    const created = (await postRes.json()) as { id: string };",
    "",
    `    const getRes = await fetch(base + "/api/${entityName}");`,
    "    const all = (await getRes.json()) as Array<{ id: string }>;",
    "    expect(all.some((r) => r.id === created.id)).toBe(true);",
    "    server.close();",
    "  });",
    "",
    '  it("rejects a malformed POST body with 400", async () => {',
    "    const { server, base } = await listen();",
    `    const res = await fetch(base + "/api/${entityName}", {`,
    '      method: "POST",',
    '      headers: { "content-type": "application/json" },',
    "      body: JSON.stringify({}),",
    "    });",
    "    expect(res.status).toBe(400);",
    "    server.close();",
    "  });",
    "});",
    "",
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — genuinely derived from the task's own real
 * allowedFiles and the architecture's own real entity, never a static
 * stub: which branch runs is decided by which files this task actually
 * owns, exactly the same real data the live-model prompt itself is
 * built from.
 */
function buildDevEngineeringFixture(task: EngineeringTask, entity: EntityInfo, allowedFiles: readonly string[]): EngineeringOutput {
  const dataFields = entity.fields.filter((f) => f !== "id" && f !== "createdAt");

  if (allowedFiles.includes("src/store.ts")) {
    return {
      files: [
        { relativePath: "src/store.ts", content: buildStoreFileContent(dataFields) },
        { relativePath: "tests/store.test.ts", content: buildStoreTestFileContent(entity.name, dataFields) },
      ],
      indexMount: null,
      implementationSummary: `Implemented an in-process store for ${entity.name} with create()/list().`,
      knownLimitations: ["Not persisted across process restarts — an in-process array only, per the MVP architecture's own MUST_HAVE database choice."],
    };
  }

  if (allowedFiles.includes("src/routes.ts")) {
    return {
      files: [
        { relativePath: "src/routes.ts", content: buildRoutesFileContent(entity.name, dataFields) },
        { relativePath: "tests/routes.test.ts", content: buildRoutesTestFileContent(entity.name, dataFields) },
      ],
      indexMount: {
        importLine: `import { ${entity.name}Router } from "./routes.js";`,
        mountLine: `  app.use("/api/${entity.name}", ${entity.name}Router);`,
      },
      implementationSummary: `Implemented the ${entity.name} API (POST/GET) and mounted it on the existing app.`,
      knownLimitations: ["No authentication — matches the MVP architecture's own DEFERRED tier for this thesis test."],
    };
  }

  throw new ValidationError(`Task ${task.id}'s allowedFiles do not match any known Engineering Agent fixture shape.`);
}

/**
 * A retry-safe insertion (§28): if a prior attempt already spliced
 * these exact lines in, does nothing rather than double-inserting —
 * the second call a bounded retry can legitimately make against the
 * same shared scaffold file.
 */
function spliceIndexTs(currentContent: string, importLine: string, mountLine: string): string {
  if (currentContent.includes(importLine) && currentContent.includes(mountLine)) {
    return currentContent;
  }
  const lines = currentContent.split("\n");
  const importIndex = lines.findIndex((line) => line.startsWith("import "));
  if (importIndex === -1) {
    throw new ValidationError("Cannot splice into src/index.ts — no existing import line found to anchor against.");
  }
  const withImport = [...lines.slice(0, importIndex + 1), importLine, ...lines.slice(importIndex + 1)];

  const returnIndex = withImport.findIndex((line) => line.trim() === "return app;");
  if (returnIndex === -1) {
    throw new ValidationError('Cannot splice into src/index.ts — no "return app;" line found to anchor against.');
  }
  const withMount = [...withImport.slice(0, returnIndex), mountLine, ...withImport.slice(returnIndex)];

  return withMount.join("\n");
}

/**
 * The Engineering Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §11-13) —
 * implements exactly one EngineeringTask inside its Product's
 * workspace, self-checked with a real `tsc --noEmit` before it may
 * report COMPLETED. A typecheck failure is a normal, non-exceptional
 * business outcome (the same shape as every other agent's "negative"
 * verdict, e.g. responseAnalystService's NOT_INTERESTED) — the
 * EngineeringTask moves to FAILED so the caller can bounded-retry via
 * engineeringTaskService.recordAttempt, while the AgentExecution
 * itself still reports COMPLETED.
 */
export const engineeringAgentService = {
  async run(params: RunEngineeringAgentParams): Promise<RunOutcome<EngineeringAgentResult>> {
    const task = await engineeringTaskService.getOrThrow(params.engineeringTaskId);
    if (task.assignedAgentId !== params.agentId) {
      throw new ValidationError(`Engineering task ${task.id} is assigned to agent ${task.assignedAgentId}, not ${params.agentId}.`);
    }
    if (task.status !== "PENDING" && task.status !== "FAILED") {
      throw new ValidationError(`Engineering task ${task.id} is ${task.status} — the Engineering Agent only runs a PENDING or FAILED (retryable) task.`);
    }

    const dependsOnTaskIds: string[] = fromJsonString(task.dependsOnTaskIds, []);
    for (const dependencyId of dependsOnTaskIds) {
      const dependency = await engineeringTaskService.getOrThrow(dependencyId);
      if (dependency.status !== "COMPLETED") {
        throw new ValidationError(`Engineering task ${task.id} depends on task ${dependencyId}, which is ${dependency.status} (not COMPLETED) — cannot run out of order.`);
      }
    }

    const architecture = await mvpArchitectureRepository.findById(task.mvpArchitectureId);
    if (!architecture) throw new NotFoundError("MvpArchitecture", task.mvpArchitectureId);
    const product = await productRepository.findById(task.productId);
    if (!product) throw new NotFoundError("Product", task.productId);
    if (!product.workspacePath) {
      throw new ValidationError(`Product ${product.id} has no provisioned workspace yet — call workspaceService.provision first.`);
    }
    const workspacePath = product.workspacePath;

    const design = fromJsonString<ParsedDesign>(architecture.designJson, { coreEntities: [] });
    const entity = design.coreEntities[0];
    if (!entity) throw new ValidationError(`MvpArchitecture ${architecture.id} has no core entity for the Engineering Agent to build against.`);

    const allowedFiles: string[] = fromJsonString(task.allowedFiles, []);
    const needsIndexMount = allowedFiles.includes("src/index.ts");
    const currentIndexContent = needsIndexMount ? await readFile(resolveWorkspacePath(workspacePath, "src/index.ts"), "utf-8") : null;

    await engineeringTaskService.setStatus(task.id, "IN_PROGRESS", { actorType: "AGENT", actorId: params.agentId });

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { engineeringTaskId: task.id },
      startedBy: params.startedBy,
    });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, engineeringOutputSchema, {
          systemPrompt: ENGINEERING_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildEngineeringPrompt(task, entity, allowedFiles, currentIndexContent) }],
          devFixtureResponse: buildDevEngineeringFixture(task, entity, allowedFiles),
        });

        handle.step();
        validateEngineeringOutput(task, output, allowedFiles, needsIndexMount);

        const filesWritten: string[] = [];
        for (const file of output.files) {
          handle.step();
          await handle.callTool("write_workspace_file", { workspacePath, relativePath: file.relativePath, content: file.content });
          filesWritten.push(file.relativePath);
        }

        if (output.indexMount && currentIndexContent !== null) {
          handle.step();
          const spliced = spliceIndexTs(currentIndexContent, output.indexMount.importLine, output.indexMount.mountLine);
          await handle.callTool("write_workspace_file", { workspacePath, relativePath: "src/index.ts", content: spliced });
          filesWritten.push("src/index.ts");
        }

        handle.step();
        const typecheckResult = (await handle.callTool("run_workspace_command", { workspacePath, command: "typecheck" })) as { exitCode: number; stdout: string; stderr: string };
        const typecheckPassed = typecheckResult.exitCode === 0;
        const typecheckOutput = `${typecheckResult.stdout}\n${typecheckResult.stderr}`.trim();

        // Every tool call this execution will ever make is done by this point — PROCESSING_RESULT is a one-way transition (RUNNING/WAITING_FOR_TOOL cannot be re-entered from it).
        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const dependencyCheck = checkDependencies(output.files.map((f) => f.content));

        if (!typecheckPassed) {
          const failed = await engineeringTaskService.setStatus(task.id, "FAILED", { actorType: "AGENT", actorId: params.agentId });
          await auditService.record({
            actorType: "AGENT",
            actorId: params.agentId,
            action: "ENGINEERING_TASK_TYPECHECK_FAILED",
            resourceType: "ENGINEERING_TASK",
            resourceId: task.id,
            result: "FAILURE",
            metadata: { typecheckOutput: typecheckOutput.slice(0, 2000) },
          });
          return { task: failed, typecheckPassed: false, typecheckOutput, filesWritten };
        }

        const completed = await engineeringTaskRepository.recordImplementation(task.id, {
          filesChanged: toJsonString(filesWritten),
          implementationSummary: output.implementationSummary,
          knownLimitations: toJsonString(output.knownLimitations),
          dependencyRecords: toJsonString(dependencyCheck.allowed.map((name) => ({ name, purpose: "Used by this task's generated code." }))),
        });
        const finalTask = await engineeringTaskService.setStatus(completed.id, "COMPLETED", { actorType: "AGENT", actorId: params.agentId });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "IMPLEMENT_ENGINEERING_TASK",
          resourceType: "ENGINEERING_TASK",
          resourceId: task.id,
          result: "SUCCESS",
          metadata: { filesWritten, dependencies: dependencyCheck.allowed },
        });
        await eventBus.publish({ type: "ENGINEERING_TASK_COMPLETED", payload: { engineeringTaskId: task.id, productId: product.id, filesWritten } });

        return { task: finalTask, typecheckPassed: true, typecheckOutput, filesWritten };
      },
      ENGINEERING_AGENT_BUDGET,
    );

    // The execution itself did not complete (budget exceeded, an uncaught
    // error inside the callback — e.g. validateEngineeringOutput's own
    // refusal) BEFORE reaching the soft-fail typecheck path above, which
    // already leaves the task cleanly FAILED. Without this, the task
    // would be stuck in IN_PROGRESS forever — no bounded retry
    // (engineeringTaskService.recordAttempt, §28) can reach a task that
    // isn't PENDING or FAILED.
    if (outcome.status !== "COMPLETED") {
      const stuck = await engineeringTaskService.getOrThrow(task.id);
      if (stuck.status === "IN_PROGRESS") {
        await engineeringTaskService.setStatus(task.id, "FAILED", { actorType: "AGENT", actorId: params.agentId });
      }
    }

    return outcome;
  },
};

/** Never trust the model's own file list or dependency choices on faith (§12, §17) — checked against real, persisted ground truth before a single byte is written. */
function validateEngineeringOutput(task: EngineeringTask, output: EngineeringOutput, allowedFiles: readonly string[], needsIndexMount: boolean): void {
  for (const file of output.files) {
    if (!allowedFiles.includes(file.relativePath)) {
      throw new ValidationError(`Engineering task ${task.id} is not permitted to write "${file.relativePath}" — not in its own allowedFiles.`);
    }
  }
  if (needsIndexMount && !output.indexMount) {
    throw new ValidationError(`Engineering task ${task.id} allows src/index.ts but produced no indexMount to splice into it.`);
  }
  if (!needsIndexMount && output.indexMount) {
    throw new ValidationError(`Engineering task ${task.id} does not allow src/index.ts but produced an indexMount anyway.`);
  }

  const allContent = output.files.map((f) => f.content);
  if (output.indexMount) allContent.push(output.indexMount.importLine);
  const dependencyCheck = checkDependencies(allContent);
  if (dependencyCheck.violations.length > 0) {
    throw new ValidationError(`Engineering task ${task.id} references dependencies that are not installed anywhere the workspace can resolve: ${dependencyCheck.violations.join(", ")}.`);
  }
}

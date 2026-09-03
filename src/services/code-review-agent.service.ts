import { readFile } from "node:fs/promises";
import type { CodeReview, EngineeringTask } from "@prisma/client";
import { z } from "zod";
import { codeReviewRepository } from "../db/repositories/code-review.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { REVIEW_FINDING_SEVERITIES, hasBlockingFinding, isReviewFindingSeverity } from "../domain/code-review/code-review.types.js";
import { resolveWorkspacePath } from "../domain/workspace/workspace-path.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { engineeringTaskService } from "./engineering-task.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §14) — pure judgment over the already-written, already-typechecked code on disk. */
export const CODE_REVIEW_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const findingSchema = z.object({
  severity: z.enum(REVIEW_FINDING_SEVERITIES),
  category: z.string().min(1),
  /** A real path from filesChanged — never trusted from the model alone, filtered against ground truth before persisting. */
  file: z.string().min(1),
  detail: z.string().min(1),
});

const codeReviewOutputSchema = z.object({
  findings: z.array(findingSchema),
  reasoning: z.string().min(1),
});
type CodeReviewOutput = z.infer<typeof codeReviewOutputSchema>;

export interface RunCodeReviewParams {
  agentId: string;
  engineeringTaskId: string;
  startedBy: AuthenticatedActor;
}

export interface CodeReviewResult {
  codeReview: CodeReview;
}

const CODE_REVIEW_SYSTEM_PROMPT =
  "You are the Code Review Agent for VentureForge's SaaS Factory (docs/M6_ARCHITECTURE_PROPOSAL.md §14). Review " +
  "the given, already-typechecked source files written for one EngineeringTask. Flag real problems only: security " +
  "issues (BLOCKER), correctness bugs and missing input validation (HIGH), missing error handling or unclear code " +
  "(MEDIUM), and style nits like leftover console.log/TODO markers (LOW). Do not invent problems that are not " +
  "actually present — a clean, correct, minimal implementation should receive zero or few LOW findings, not " +
  "manufactured criticism. Cite the real relativePath for every finding. " +
  'Respond with ONLY JSON matching: {"findings": [{"severity": "BLOCKER"|"HIGH"|"MEDIUM"|"LOW", "category": ' +
  'string, "file": string, "detail": string}], "reasoning": string}';

function buildCodeReviewPrompt(task: EngineeringTask, files: readonly { relativePath: string; content: string }[]): string {
  return [
    `Task: ${task.title}`,
    `Purpose: ${task.purpose}`,
    "",
    ...files.flatMap((f) => [`--- ${f.relativePath} ---`, f.content, ""]),
  ].join("\n");
}

interface CodeSmellFinding {
  severity: (typeof REVIEW_FINDING_SEVERITIES)[number];
  category: string;
  file: string;
  detail: string;
}

/**
 * DEVELOPMENT ONLY — a genuine, deterministic static scan of the real
 * file content (never a canned "looks good" response): a handful of
 * defensible, real code-smell patterns a human reviewer would actually
 * flag. For the Engineering Agent's own clean, dev-fixture-generated
 * code this legitimately comes back empty — an honest clean review,
 * not a manufactured one (docs/M6_ARCHITECTURE_PROPOSAL.md §14).
 */
function buildDevCodeReviewFixture(files: readonly { relativePath: string; content: string }[]): CodeReviewOutput {
  const findings: CodeSmellFinding[] = [];
  for (const file of files) {
    if (file.content.includes("eval(") || file.content.includes("new Function(")) {
      findings.push({ severity: "BLOCKER", category: "security", file: file.relativePath, detail: "Dynamic code execution (eval/Function) is never acceptable in generated product code." });
    }
    if (file.content.includes("console.log(")) {
      findings.push({ severity: "LOW", category: "style", file: file.relativePath, detail: "Leftover console.log — remove before this is considered production-track code." });
    }
    if (file.content.includes("// TODO") || file.content.includes("// FIXME")) {
      findings.push({ severity: "MEDIUM", category: "completeness", file: file.relativePath, detail: "Leftover TODO/FIXME marker — either finish the work or remove the comment." });
    }
  }
  return {
    findings,
    reasoning: findings.length === 0 ? "No real problems found — the implementation is small, typed, and matches its stated acceptance criteria." : `${findings.length} real issue(s) found via static scan.`,
  };
}

/**
 * The Code Review Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §14) —
 * judges the already-typechecked code an EngineeringTask produced.
 * Never changes the EngineeringTask's own status: a BLOCKER finding is
 * a fact recorded here for the factory orchestrator (§34's REVIEWING
 * -> BUILDING edge) to act on, not something this agent enforces
 * itself — mirrors the QA/Integration-Test split (judgment vs.
 * mechanical re-run) applied to code quality instead of test coverage.
 */
export const codeReviewAgentService = {
  async run(params: RunCodeReviewParams): Promise<RunOutcome<CodeReviewResult>> {
    const task = await engineeringTaskService.getOrThrow(params.engineeringTaskId);
    if (task.status !== "COMPLETED") {
      throw new ValidationError(`Engineering task ${task.id} is ${task.status} — Code Review only runs against a COMPLETED (typechecked) implementation.`);
    }
    const product = await productRepository.findById(task.productId);
    if (!product) throw new NotFoundError("Product", task.productId);
    if (!product.workspacePath) throw new ValidationError(`Product ${product.id} has no workspace path.`);
    const workspacePath = product.workspacePath;

    const filesChanged: string[] = fromJsonString(task.filesChanged ?? "[]", []);
    if (filesChanged.length === 0) {
      throw new ValidationError(`Engineering task ${task.id} has no recorded filesChanged to review.`);
    }
    const files = await Promise.all(
      filesChanged.map(async (relativePath) => ({
        relativePath,
        content: await readFile(resolveWorkspacePath(workspacePath, relativePath), "utf-8"),
      })),
    );

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { engineeringTaskId: task.id },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: output } = await completeWithValidation(handle.callModel, codeReviewOutputSchema, {
          systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildCodeReviewPrompt(task, files) }],
          devFixtureResponse: buildDevCodeReviewFixture(files),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust a finding's file citation on faith — must be a real file this task actually touched.
        const validFiles = new Set(filesChanged);
        const findings = output.findings.filter((f) => validFiles.has(f.file) && isReviewFindingSeverity(f.severity));
        const blocking = hasBlockingFinding(findings.map((f) => f.severity));

        const codeReview = await codeReviewRepository.create({
          engineeringTaskId: task.id,
          findings: toJsonString(findings),
          hasBlockingFinding: blocking,
          reasoning: output.reasoning,
          reviewedByAgentId: params.agentId,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_CODE_REVIEW",
          resourceType: "ENGINEERING_TASK",
          resourceId: task.id,
          result: "SUCCESS",
          metadata: { codeReviewId: codeReview.id, findingCount: findings.length, hasBlockingFinding: blocking },
        });

        return { codeReview };
      },
      CODE_REVIEW_AGENT_BUDGET,
    );
  },
};

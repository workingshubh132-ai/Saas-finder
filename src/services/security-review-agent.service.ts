import { readFile } from "node:fs/promises";
import type { EngineeringTask, SecurityReview } from "@prisma/client";
import { z } from "zod";
import { securityReviewRepository } from "../db/repositories/security-review.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { scanForSecurityIssues } from "../domain/security-review/security-scan.js";
import { SECURITY_VERDICTS, type SecurityFinding } from "../domain/security-review/security-review.types.js";
import { resolveWorkspacePath } from "../domain/workspace/workspace-path.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { engineeringTaskService } from "./engineering-task.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/** Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §16) — a real deterministic scan plus model judgment over already-written code, never a live network/tool action. */
export const SECURITY_REVIEW_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const findingSchema = z.object({
  category: z.string().min(1),
  /** A real path from filesChanged — never trusted from the model alone. */
  file: z.string().min(1),
  detail: z.string().min(1),
  /** Concrete evidence (the actual offending snippet) — never a bare accusation (brief §17). */
  evidence: z.string().min(1),
});

const securityOutputSchema = z.object({
  verdict: z.enum(SECURITY_VERDICTS),
  findings: z.array(findingSchema),
  reasoning: z.string().min(1),
});
type SecurityOutput = z.infer<typeof securityOutputSchema>;

export interface RunSecurityReviewParams {
  agentId: string;
  engineeringTaskId: string;
  startedBy: AuthenticatedActor;
}

export interface SecurityReviewResult {
  securityReview: SecurityReview;
}

const SECURITY_AGENT_SYSTEM_PROMPT =
  "You are the Security Agent for VentureForge's SaaS Factory (docs/M6_ARCHITECTURE_PROPOSAL.md §16). Review the " +
  "given source files for REAL vulnerabilities only — every finding must cite concrete evidence (the actual " +
  "offending code snippet), never a bare accusation. You are also given the results of a deterministic static " +
  "scan already run over the same files (for code injection, hardcoded secrets, and unsafe shell exec) — include " +
  "those findings verbatim, plus any other real, concrete issue you can see (missing input validation on a route " +
  "that trusts a network body, unsafe path handling, etc.). Do not invent a vulnerability that is not actually " +
  "present. FAIL if any real vulnerability exists; PASS_WITH_WARNINGS for a real but low-severity concern; PASS " +
  "only if the code is genuinely clean. " +
  'Respond with ONLY JSON matching: {"verdict": "PASS"|"PASS_WITH_WARNINGS"|"FAIL", "findings": [{"category": ' +
  'string, "file": string, "detail": string, "evidence": string}], "reasoning": string}';

function buildSecurityPrompt(task: EngineeringTask, files: readonly { relativePath: string; content: string }[], scanFindings: readonly SecurityFinding[]): string {
  return [
    `Task: ${task.title}`,
    "",
    `Deterministic static scan already found ${scanFindings.length} issue(s):`,
    ...scanFindings.map((f) => `- [${f.category}] ${f.file}: ${f.detail} (evidence: ${f.evidence})`),
    "",
    ...files.flatMap((f) => [`--- ${f.relativePath} ---`, f.content, ""]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — the model-judgment stand-in simply reports the
 * real deterministic scan's own real findings (never inventing
 * anything beyond them): for the Engineering Agent's own clean
 * dev-fixture-generated code, the scan legitimately finds nothing, so
 * this legitimately returns PASS — an honest result, not a canned one.
 */
function buildDevSecurityFixture(scanFindings: readonly SecurityFinding[]): SecurityOutput {
  return {
    verdict: scanFindings.length === 0 ? "PASS" : "FAIL",
    findings: [...scanFindings],
    reasoning: scanFindings.length === 0 ? "The deterministic security scan found no real vulnerabilities in the files this task changed." : `The deterministic security scan found ${scanFindings.length} real issue(s).`,
  };
}

/**
 * The Security Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §16) — the
 * last automated gate before Product moves to HUMAN_REVIEW (§34).
 * Combines a real deterministic scan (always run, never skipped) with
 * model judgment for what a fixed rule set cannot reach. Like Code
 * Review/QA, never changes the EngineeringTask's own status.
 */
export const securityReviewAgentService = {
  async run(params: RunSecurityReviewParams): Promise<RunOutcome<SecurityReviewResult>> {
    const task = await engineeringTaskService.getOrThrow(params.engineeringTaskId);
    if (task.status !== "COMPLETED") {
      throw new ValidationError(`Engineering task ${task.id} is ${task.status} — Security Review only runs against a COMPLETED (typechecked) implementation.`);
    }
    const product = await productRepository.findById(task.productId);
    if (!product) throw new NotFoundError("Product", task.productId);
    if (!product.workspacePath) throw new ValidationError(`Product ${product.id} has no workspace path.`);
    const workspacePath = product.workspacePath;

    const filesChanged: string[] = fromJsonString(task.filesChanged ?? "[]", []);
    if (filesChanged.length === 0) {
      throw new ValidationError(`Engineering task ${task.id} has no recorded filesChanged for Security Review.`);
    }
    const files = await Promise.all(
      filesChanged.map(async (relativePath) => ({
        relativePath,
        content: await readFile(resolveWorkspacePath(workspacePath, relativePath), "utf-8"),
      })),
    );
    const scanFindings = scanForSecurityIssues(files);

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
        const { value: output } = await completeWithValidation(handle.callModel, securityOutputSchema, {
          systemPrompt: SECURITY_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildSecurityPrompt(task, files, scanFindings) }],
          devFixtureResponse: buildDevSecurityFixture(scanFindings),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // The deterministic scan's own findings are never optional — merged in regardless of what the model reported, so a live model can never talk its way out of a real, mechanically-detected issue.
        const validFiles = new Set(filesChanged);
        const modelFindings = output.findings.filter((f) => validFiles.has(f.file));
        const mergedFindings = [...scanFindings, ...modelFindings.filter((f) => !scanFindings.some((s) => s.category === f.category && s.file === f.file && s.evidence === f.evidence))];
        const verdict = scanFindings.length > 0 ? "FAIL" : output.verdict;

        const securityReview = await securityReviewRepository.create({
          engineeringTaskId: task.id,
          verdict,
          findings: toJsonString(mergedFindings),
          reasoning: output.reasoning,
          reviewedByAgentId: params.agentId,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_SECURITY_REVIEW",
          resourceType: "ENGINEERING_TASK",
          resourceId: task.id,
          result: "SUCCESS",
          metadata: { securityReviewId: securityReview.id, verdict, findingCount: mergedFindings.length },
        });
        await eventBus.publish({ type: "SECURITY_REVIEW_COMPLETED", payload: { securityReviewId: securityReview.id, engineeringTaskId: task.id, productId: product.id, verdict } });

        return { securityReview };
      },
      SECURITY_REVIEW_AGENT_BUDGET,
    );
  },
};

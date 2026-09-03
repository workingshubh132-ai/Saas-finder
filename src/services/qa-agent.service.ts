import { readFile } from "node:fs/promises";
import type { EngineeringTask, QaReport } from "@prisma/client";
import { z } from "zod";
import { qaReportRepository } from "../db/repositories/qa-report.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { QA_VERDICTS } from "../domain/qa/qa.types.js";
import { resolveWorkspacePath } from "../domain/workspace/workspace-path.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { fromJsonString, toJsonString } from "../domain/shared/json.js";
import { engineeringTaskService } from "./engineering-task.service.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1024;

/**
 * Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §15) — pure
 * judgment about test COVERAGE. Distinct from the separate,
 * mechanical Integration Test pipeline stage that actually re-runs
 * `vitest` (brief §16's own QA-vs-test-execution split, mirroring this
 * codebase's established "deterministic input factors + model
 * judgment" pattern, e.g. the Evidence Validator).
 */
export const QA_AGENT_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const qaOutputSchema = z.object({
  verdict: z.enum(QA_VERDICTS),
  /** Real gaps against this task's own real testsRequired — never invented scope. */
  missingTests: z.array(z.string().min(1)),
  findings: z.array(z.string().min(1)),
  reasoning: z.string().min(1),
});
type QaOutput = z.infer<typeof qaOutputSchema>;

export interface RunQaAgentParams {
  agentId: string;
  engineeringTaskId: string;
  startedBy: AuthenticatedActor;
}

export interface QaAgentResult {
  qaReport: QaReport;
}

const QA_AGENT_SYSTEM_PROMPT =
  "You are the QA Agent for VentureForge's SaaS Factory (docs/M6_ARCHITECTURE_PROPOSAL.md §15). You judge test " +
  "COVERAGE — you do not run tests yourself, a separate mechanical stage already ran the real suite. Given this " +
  "task's own required test cases and the real source and test files it produced, identify which required cases " +
  "are genuinely uncovered, and flag any other real gap: missing empty-state, error-path, or boundary coverage " +
  "for behavior the source code actually implements. Never invent a requirement that was not actually listed. " +
  "PASS only if every required case is covered; PASS_WITH_GAPS if coverage is real but incomplete; FAIL if " +
  "coverage is essentially absent. " +
  'Respond with ONLY JSON matching: {"verdict": "PASS"|"PASS_WITH_GAPS"|"FAIL", "missingTests": string[], ' +
  '"findings": string[], "reasoning": string}';

function buildQaPrompt(task: EngineeringTask, files: readonly { relativePath: string; content: string }[]): string {
  const testsRequired: string[] = fromJsonString(task.testsRequired, []);
  return [
    `Task: ${task.title}`,
    "Required test cases:",
    ...testsRequired.map((t) => `- ${t}`),
    "",
    ...files.flatMap((f) => [`--- ${f.relativePath} ---`, f.content, ""]),
  ].join("\n");
}

function countTestCases(content: string): number {
  return (content.match(/\bit\(\s*["'`]/g) ?? []).length;
}

/**
 * DEVELOPMENT ONLY — a genuine, mechanical count against real
 * requirements (never a canned PASS): counts real `it(...)` blocks in
 * this task's own real test files against its own real testsRequired
 * length. Deliberately conservative about WHICH cases are missing
 * (reports a real deficit rather than guessing semantic matches it
 * cannot actually verify) — an honest "N real tests found" is worth
 * more than a fabricated one-to-one mapping.
 */
function buildDevQaFixture(testsRequired: readonly string[], testFiles: readonly { relativePath: string; content: string }[]): QaOutput {
  const actualTestCount = testFiles.reduce((sum, f) => sum + countTestCases(f.content), 0);
  const missingTests = actualTestCount < testsRequired.length ? testsRequired.slice(actualTestCount) : [];
  const findings: string[] = testFiles.length === 0 ? ["No test files were changed by this task."] : [];

  const verdict: QaOutput["verdict"] = missingTests.length === 0 ? "PASS" : actualTestCount === 0 ? "FAIL" : "PASS_WITH_GAPS";

  return {
    verdict,
    missingTests,
    findings,
    reasoning:
      missingTests.length === 0
        ? `All ${testsRequired.length} required test case(s) appear covered by ${actualTestCount} real test case(s) across ${testFiles.length} test file(s).`
        : `Found ${actualTestCount} real test case(s) against ${testsRequired.length} required — ${missingTests.length} appear uncovered.`,
  };
}

/**
 * The QA Agent (docs/M6_ARCHITECTURE_PROPOSAL.md §15) — judges test
 * coverage for an already-COMPLETED (typechecked) EngineeringTask.
 * Like Code Review, never changes the EngineeringTask's own status;
 * its verdict is a fact for the factory orchestrator to act on.
 */
export const qaAgentService = {
  async run(params: RunQaAgentParams): Promise<RunOutcome<QaAgentResult>> {
    const task = await engineeringTaskService.getOrThrow(params.engineeringTaskId);
    if (task.status !== "COMPLETED") {
      throw new ValidationError(`Engineering task ${task.id} is ${task.status} — QA only runs against a COMPLETED (typechecked) implementation.`);
    }
    const product = await productRepository.findById(task.productId);
    if (!product) throw new NotFoundError("Product", task.productId);
    if (!product.workspacePath) throw new ValidationError(`Product ${product.id} has no workspace path.`);
    const workspacePath = product.workspacePath;

    const filesChanged: string[] = fromJsonString(task.filesChanged ?? "[]", []);
    if (filesChanged.length === 0) {
      throw new ValidationError(`Engineering task ${task.id} has no recorded filesChanged for QA to review.`);
    }
    const files = await Promise.all(
      filesChanged.map(async (relativePath) => ({
        relativePath,
        content: await readFile(resolveWorkspacePath(workspacePath, relativePath), "utf-8"),
      })),
    );
    const testFiles = files.filter((f) => f.relativePath.startsWith("tests/"));
    const testsRequired: string[] = fromJsonString(task.testsRequired, []);

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
        const { value: output } = await completeWithValidation(handle.callModel, qaOutputSchema, {
          systemPrompt: QA_AGENT_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildQaPrompt(task, files) }],
          devFixtureResponse: buildDevQaFixture(testsRequired, testFiles),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const qaReport = await qaReportRepository.create({
          engineeringTaskId: task.id,
          verdict: output.verdict,
          missingTests: toJsonString(output.missingTests),
          findings: toJsonString(output.findings),
          reasoning: output.reasoning,
          reviewedByAgentId: params.agentId,
        });

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_QA_REPORT",
          resourceType: "ENGINEERING_TASK",
          resourceId: task.id,
          result: "SUCCESS",
          metadata: { qaReportId: qaReport.id, verdict: output.verdict, missingTestCount: output.missingTests.length },
        });

        return { qaReport };
      },
      QA_AGENT_BUDGET,
    );
  },
};

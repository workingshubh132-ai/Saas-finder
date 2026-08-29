import type { AgentExecution } from "@prisma/client";
import type { CompletionRequest, CompletionResult } from "../domain/ports/model-provider.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { EXECUTION_STATUS_TRANSITIONS, isExecutionStatus, type ExecutionStatus } from "../domain/execution/execution.types.js";
import {
  AuthorizationDeniedError,
  BudgetExceededError,
  DomainError,
  ModelError,
  NotFoundError,
  ToolError,
  ValidationError,
} from "../domain/shared/errors.js";
import type { ErrorCode } from "../domain/shared/error-codes.js";
import { toJsonString } from "../domain/shared/json.js";
import { withBoundedRetry } from "../domain/shared/retry.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { agentExecutionRepository } from "../db/repositories/agent-execution.repository.js";
import { toolExecutionRepository } from "../db/repositories/tool-execution.repository.js";
import { createModelProvider } from "../providers/model-provider-factory.js";
import { toolRegistry } from "../tools/tool-registry.js";
import { agentService } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { authorizationService } from "./authorization.service.js";
import { eventBus } from "./event-bus.js";

export interface ExecutionBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxModelCalls: number;
  /** Total retryable-failure retries allowed across the whole execution. */
  maxRetries: number;
  maxDurationMs: number;
}

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  maxSteps: 6,
  maxToolCalls: 3,
  maxModelCalls: 3,
  maxRetries: 2,
  maxDurationMs: 30_000,
};

export interface ExecutionHandle {
  readonly executionId: string;
  readonly agentId: string;
  /** Advance the execution's own lifecycle status (e.g. into PROCESSING_RESULT before finalizing). */
  transition(toStatus: ExecutionStatus): Promise<void>;
  /** Budget-checked model call. Bounded transport-level retry only — schema-correction retries are the caller's job. */
  callModel(request: CompletionRequest): Promise<CompletionResult>;
  /** Budget-checked, Guardian-authorized tool call. Handles the RUNNING<->WAITING_FOR_TOOL transition and the ToolExecution audit row itself. */
  callTool(toolId: string, input: unknown): Promise<unknown>;
  /** Records one logical step against the step budget (the caller decides what counts as a step). */
  step(): void;
}

export type RunOutcome<T> =
  | { execution: AgentExecution; status: "COMPLETED"; result: T }
  | { execution: AgentExecution; status: "FAILED" | "CANCELLED"; result: null };

export interface StartExecutionParams {
  agentId: string;
  taskId?: string | null;
  input: unknown;
  startedBy: AuthenticatedActor;
}

function isRetryableRuntimeError(error: unknown): boolean {
  return error instanceof ToolError || error instanceof ModelError;
}

/**
 * The generic execution engine (M2_ARCHITECTURE_PROPOSAL.md §5/§10):
 * lifecycle bookkeeping, budgets, Guardian enforcement, and audit —
 * not any particular agent's plan. A specific agent (e.g.
 * research-agent.service.ts) drives its own bounded pipeline through
 * the `ExecutionHandle` this hands it, one step at a time.
 */
export const agentRuntimeService = {
  async startExecution(params: StartExecutionParams): Promise<AgentExecution> {
    await agentService.getAgentOrThrow(params.agentId);

    const execution = await agentExecutionRepository.create({
      agentId: params.agentId,
      taskId: params.taskId ?? null,
      startedByIdentityId: params.startedBy.identityId,
      input: toJsonString(params.input),
    });

    await auditService.record({
      actorType: params.startedBy.type,
      actorId: params.startedBy.id,
      action: "START_AGENT_EXECUTION",
      resourceType: "AGENT_EXECUTION",
      resourceId: execution.id,
      result: "SUCCESS",
    });

    return execution;
  },

  async getOrThrow(id: string): Promise<AgentExecution> {
    const execution = await agentExecutionRepository.findById(id);
    if (!execution) throw new NotFoundError("AgentExecution", id);
    return execution;
  },

  listExecutions: agentExecutionRepository.list,
  listToolExecutions: toolExecutionRepository.listByExecution,

  /**
   * Drives one execution through `program`. Business-shaped failures
   * (tool/model/authorization/budget) are captured as a normal FAILED
   * terminal state, not a thrown exception — the execution record IS
   * the result either way. Only a genuinely missing/corrupt execution
   * row throws.
   */
  async run<T>(
    executionId: string,
    program: (handle: ExecutionHandle) => Promise<T>,
    budgetOverrides: Partial<ExecutionBudget> = {},
  ): Promise<RunOutcome<T>> {
    const budget: ExecutionBudget = { ...DEFAULT_EXECUTION_BUDGET, ...budgetOverrides };

    let execution = await agentRuntimeService.getOrThrow(executionId);
    execution = await transitionExecution(execution, "QUEUED");
    execution = await transitionExecution(execution, "RUNNING", { startedAt: new Date() });

    const provider = createModelProvider();
    const usage = { stepCount: 0, toolCallCount: 0, modelCallCount: 0, retryCount: 0 };
    const runStartedAt = execution.startedAt ?? new Date();

    const assertWithinTimeBudget = (): void => {
      if (Date.now() - runStartedAt.getTime() > budget.maxDurationMs) {
        throw new BudgetExceededError(`Execution ${execution.id} exceeded maxDurationMs (${budget.maxDurationMs}).`);
      }
    };

    const handle: ExecutionHandle = {
      executionId: execution.id,
      agentId: execution.agentId,

      transition: async (toStatus) => {
        execution = await transitionExecution(execution, toStatus);
      },

      step: () => {
        usage.stepCount += 1;
        if (usage.stepCount > budget.maxSteps) {
          throw new BudgetExceededError(`Execution ${execution.id} exceeded maxSteps (${budget.maxSteps}).`);
        }
      },

      callModel: async (request) => {
        assertWithinTimeBudget();
        if (usage.modelCallCount >= budget.maxModelCalls) {
          throw new BudgetExceededError(`Execution ${execution.id} exceeded maxModelCalls (${budget.maxModelCalls}).`);
        }
        const result = await withBoundedRetry(() => provider.complete(request), {
          maxAttempts: budget.maxRetries + 1,
          isRetryable: isRetryableRuntimeError,
          onRetry: () => {
            usage.retryCount += 1;
          },
        });
        usage.modelCallCount += 1;
        execution = await agentExecutionRepository.update(execution.id, {
          modelCallCount: usage.modelCallCount,
          retryCount: usage.retryCount,
          modelProvider: result.provider,
          modelName: result.model,
        });
        return result;
      },

      callTool: async (toolId, input) => {
        assertWithinTimeBudget();
        if (usage.toolCallCount >= budget.maxToolCalls) {
          throw new BudgetExceededError(`Execution ${execution.id} exceeded maxToolCalls (${budget.maxToolCalls}).`);
        }

        const tool = toolRegistry.get(toolId);
        if (!tool) throw new ToolError(`Unknown tool: ${toolId}`);

        for (const permission of tool.requiredPermissions) {
          const decision = await authorizationService.authorize({
            agentId: execution.agentId,
            action: permission,
            resourceType: "TOOL",
            resourceId: tool.id,
          });
          if (decision.decision === "DENIED") {
            throw new AuthorizationDeniedError(`Agent ${execution.agentId} is not authorized to use tool "${tool.id}": ${decision.reason}`);
          }
          if (decision.decision === "REQUIRES_APPROVAL") {
            // M2 does not implement suspending an execution mid-run for
            // human approval — see docs/M2_ARCHITECTURE_PROPOSAL.md §19.
            // Failing closed is the safe default until it does.
            throw new AuthorizationDeniedError(
              `Tool "${tool.id}" requires approval (risk ${decision.riskLevel}); mid-execution approval suspension is not implemented in M2.`,
            );
          }
        }

        execution = await transitionExecution(execution, "WAITING_FOR_TOOL");
        const toolStartedAt = new Date();
        let validatedInput: unknown;
        try {
          validatedInput = tool.inputSchema.parse(input);
        } catch (error) {
          throw new ValidationError(`Invalid input for tool "${tool.id}": ${error instanceof Error ? error.message : String(error)}`);
        }

        try {
          const rawOutput = await withBoundedRetry(
            () => tool.execute(validatedInput, { agentId: execution.agentId, executionId: execution.id }),
            {
              maxAttempts: budget.maxRetries + 1,
              isRetryable: isRetryableRuntimeError,
              onRetry: () => {
                usage.retryCount += 1;
              },
            },
          );
          const output = tool.outputSchema.parse(rawOutput);
          const completedAt = new Date();
          await toolExecutionRepository.create({
            executionId: execution.id,
            toolId: tool.id,
            status: "SUCCESS",
            input: toJsonString(validatedInput),
            output: toJsonString(output),
            error: null,
            completedAt,
            durationMs: completedAt.getTime() - toolStartedAt.getTime(),
          });
          usage.toolCallCount += 1;
          execution = await agentExecutionRepository.update(execution.id, { toolCallCount: usage.toolCallCount, retryCount: usage.retryCount });
          execution = await transitionExecution(execution, "RUNNING");
          return output;
        } catch (error) {
          const completedAt = new Date();
          const message = error instanceof Error ? error.message : String(error);
          await toolExecutionRepository.create({
            executionId: execution.id,
            toolId: tool.id,
            status: "FAILED",
            input: toJsonString(validatedInput),
            output: null,
            error: message,
            completedAt,
            durationMs: completedAt.getTime() - toolStartedAt.getTime(),
          });
          throw error instanceof DomainError ? error : new ToolError(`Tool "${tool.id}" failed: ${message}`);
        }
      },
    };

    try {
      const result = await program(handle);
      execution = await transitionExecution(execution, "COMPLETED", {
        output: toJsonString(result),
        completedAt: new Date(),
        stepCount: usage.stepCount,
      });
      await auditService.record({
        actorType: "AGENT",
        actorId: execution.agentId,
        action: "AGENT_EXECUTION_COMPLETED",
        resourceType: "AGENT_EXECUTION",
        resourceId: execution.id,
        result: "SUCCESS",
      });
      return { execution, status: "COMPLETED", result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode: ErrorCode = error instanceof DomainError ? error.errorCode : "INTERNAL_ERROR";
      execution = await transitionExecution(execution, "FAILED", {
        error: message,
        errorCode,
        completedAt: new Date(),
        stepCount: usage.stepCount,
      });
      await auditService.record({
        actorType: "AGENT",
        actorId: execution.agentId,
        action: "AGENT_EXECUTION_FAILED",
        resourceType: "AGENT_EXECUTION",
        resourceId: execution.id,
        result: "FAILURE",
        reason: message,
      });
      await eventBus.publish({ type: "TASK_FAILED", payload: { executionId: execution.id, agentId: execution.agentId, errorCode, error: message } });
      return { execution, status: "FAILED", result: null };
    }
  },
};

async function transitionExecution(
  execution: AgentExecution,
  toStatus: ExecutionStatus,
  extra: Parameters<typeof agentExecutionRepository.update>[1] = {},
): Promise<AgentExecution> {
  if (!isExecutionStatus(execution.status)) {
    throw new ValidationError(`Corrupt stored status on agent execution ${execution.id}: ${execution.status}`);
  }
  assertTransition("AgentExecution", EXECUTION_STATUS_TRANSITIONS, execution.status, toStatus);
  return agentExecutionRepository.update(execution.id, { status: toStatus, ...extra });
}

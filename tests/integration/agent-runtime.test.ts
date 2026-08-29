import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentRuntimeService } from "../../src/services/agent-runtime.service.js";
import { agentService } from "../../src/services/agent.service.js";
import { toolRegistry } from "../../src/tools/tool-registry.js";
import type { Tool, ToolExecutionContext } from "../../src/tools/tool.js";
import { ToolError } from "../../src/domain/shared/errors.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

// A function, not a top-level constant: HUMAN_OWNER is a live binding
// populated by tests/setup.ts's beforeEach, which hasn't run yet when
// this module's own top-level code is first evaluated.
function startedBy() {
  return { type: "HUMAN" as const, id: HUMAN_OWNER.actorId, identityId: HUMAN_OWNER.actorId };
}

class FlakyTool implements Tool {
  readonly id = "flaky_tool";
  readonly name = "Flaky Test Tool";
  readonly description = "Fails a configurable number of times, then succeeds.";
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["READ_WEB"] as const;
  readonly inputSchema = z.object({});
  readonly outputSchema = z.object({ ok: z.boolean() });
  callCount = 0;

  constructor(private readonly failUntilCall: number) {}

  execute(_input: unknown, _context: ToolExecutionContext): Promise<unknown> {
    this.callCount += 1;
    if (this.callCount <= this.failUntilCall) {
      throw new ToolError(`simulated failure #${this.callCount}`);
    }
    return Promise.resolve({ ok: true });
  }
}

class AlwaysFailsTool implements Tool {
  readonly id = "always_fails_tool";
  readonly name = "Always Fails";
  readonly description = "Never succeeds — used to prove retries are bounded, not infinite.";
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["READ_WEB"] as const;
  readonly inputSchema = z.object({});
  readonly outputSchema = z.object({ ok: z.boolean() });
  callCount = 0;

  execute(): Promise<unknown> {
    this.callCount += 1;
    throw new ToolError("always fails");
  }
}

async function authorizedAgent() {
  const agent = await makeAgent();
  await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  return agent;
}

describe("agentRuntimeService", () => {
  it("an execution starts, runs, and completes with the program's result", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: { x: 1 }, startedBy: startedBy() });
    expect(execution.status).toBe("CREATED");

    const outcome = await agentRuntimeService.run(execution.id, async () => "done");

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result).toBe("done");
    expect(outcome.execution.completedAt).not.toBeNull();
  });

  it("a tool call occurs, is authorized, and is recorded as a ToolExecution", async () => {
    const agent = await authorizedAgent();
    toolRegistry.register(new FlakyTool(0));
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(execution.id, async (handle) => handle.callTool("flaky_tool", {}));

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.execution.toolCallCount).toBe(1);
    const toolExecutions = await agentRuntimeService.listToolExecutions(execution.id);
    expect(toolExecutions).toHaveLength(1);
    expect(toolExecutions[0]?.status).toBe("SUCCESS");
  });

  it("structured model output validates against the caller's schema", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });
    const schema = z.object({ greeting: z.string() });

    const outcome = await agentRuntimeService.run(execution.id, async (handle) => {
      const result = await handle.callModel({ messages: [{ role: "user", content: "hi" }], devFixtureResponse: { greeting: "hello" } });
      return schema.parse(JSON.parse(result.content));
    });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.result).toEqual({ greeting: "hello" });
    expect(outcome.execution.modelCallCount).toBe(1);
  });

  it("a thrown failure inside the program is recorded as FAILED with the right errorCode, not left as an exception", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(execution.id, async () => {
      throw new Error("boom");
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.result).toBeNull();
    expect(outcome.execution.error).toContain("boom");
    expect(outcome.execution.errorCode).toBe("INTERNAL_ERROR");
  });

  it("an unregistered tool is rejected as a TOOL_ERROR", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(execution.id, async (handle) => handle.callTool("does_not_exist", {}));

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("TOOL_ERROR");
  });

  it("a tool call is denied when the agent lacks the required permission (fails closed)", async () => {
    const agent = await makeAgent(); // no READ_WEB grant
    toolRegistry.register(new FlakyTool(0));
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(execution.id, async (handle) => handle.callTool("flaky_tool", {}));

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("AUTHORIZATION_ERROR");
    expect(outcome.execution.toolCallCount).toBe(0);
  });

  it("invalid tool input is rejected as a VALIDATION_ERROR before the tool ever runs", async () => {
    const agent = await authorizedAgent();
    const tool = new FlakyTool(0);
    // Give this tool a required field so a bad input is actually distinguishable from "no input".
    Object.assign(tool, { inputSchema: z.object({ required: z.string() }) });
    toolRegistry.register(tool);
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(execution.id, async (handle) => handle.callTool("flaky_tool", {}));

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("VALIDATION_ERROR");
    expect(tool.callCount).toBe(0);
  });

  it("maxToolCalls budget is enforced", async () => {
    const agent = await authorizedAgent();
    toolRegistry.register(new FlakyTool(0));
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => {
        await handle.callTool("flaky_tool", {});
        await handle.callTool("flaky_tool", {});
        return "unreachable";
      },
      { maxToolCalls: 1 },
    );

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("BUDGET_EXCEEDED");
    expect(outcome.execution.toolCallCount).toBe(1);
  });

  it("maxModelCalls budget is enforced", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => {
        await handle.callModel({ messages: [{ role: "user", content: "1" }], devFixtureResponse: { a: 1 } });
        await handle.callModel({ messages: [{ role: "user", content: "2" }], devFixtureResponse: { a: 2 } });
        return "unreachable";
      },
      { maxModelCalls: 1 },
    );

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("BUDGET_EXCEEDED");
    expect(outcome.execution.modelCallCount).toBe(1);
  });

  it("maxSteps budget is enforced", async () => {
    const agent = await makeAgent();
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        handle.step();
        return "unreachable";
      },
      { maxSteps: 1 },
    );

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("BUDGET_EXCEEDED");
  });

  it("maxDurationMs budget is enforced", async () => {
    const agent = await authorizedAgent();
    toolRegistry.register(new FlakyTool(0));
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return handle.callTool("flaky_tool", {});
      },
      { maxDurationMs: 1 },
    );

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("BUDGET_EXCEEDED");
  });

  it("a transient tool failure is retried a bounded number of times, then succeeds", async () => {
    const agent = await authorizedAgent();
    const tool = new FlakyTool(1); // fails once, succeeds on the 2nd attempt
    toolRegistry.register(tool);
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => handle.callTool("flaky_tool", {}),
      { maxRetries: 2 },
    );

    expect(outcome.status).toBe("COMPLETED");
    expect(tool.callCount).toBe(2);
    expect(outcome.execution.retryCount).toBe(1);
  });

  it("retries are bounded — an always-failing tool stops after maxRetries+1 attempts, never loops forever", async () => {
    const agent = await authorizedAgent();
    const tool = new AlwaysFailsTool();
    toolRegistry.register(tool);
    const execution = await agentRuntimeService.startExecution({ agentId: agent.id, input: {}, startedBy: startedBy() });

    const outcome = await agentRuntimeService.run(
      execution.id,
      async (handle) => handle.callTool("always_fails_tool", {}),
      { maxRetries: 2 },
    );

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("TOOL_ERROR");
    expect(tool.callCount).toBe(3); // 1 initial attempt + 2 retries, exactly — never more
  });
});

describe("tool registry", () => {
  it("a registered tool can be looked up and executed directly", async () => {
    const tool = new FlakyTool(0);
    toolRegistry.register(tool);
    const found = toolRegistry.get("flaky_tool");
    expect(found).toBeDefined();
    const output = await found?.execute({}, { agentId: "x", executionId: "y" });
    expect(output).toEqual({ ok: true });
  });

  it("an unregistered tool id returns undefined", () => {
    expect(toolRegistry.get("nonexistent_tool_id")).toBeUndefined();
  });
});

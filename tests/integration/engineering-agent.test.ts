import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineeringAgentService } from "../../src/services/engineering-agent.service.js";
import { engineeringTaskService } from "../../src/services/engineering-task.service.js";
import { workspaceService } from "../../src/services/workspace.service.js";
import { toolRegistry } from "../../src/tools/tool-registry.js";
import { authActor, makeMvpArchitecture } from "../helpers.js";

async function provisionAndDecompose() {
  const { agents, product, mvpArchitecture } = await makeMvpArchitecture();
  const workspacePath = await workspaceService.provision(product.id);
  const [storeTask, apiTask] = await engineeringTaskService.decomposeFromArchitecture(mvpArchitecture.id, agents.engineeringAgent.id);
  return { agents, product, mvpArchitecture, workspacePath, storeTask: storeTask!, apiTask: apiTask! };
}

describe("engineeringAgentService.run", () => {
  it(
    "implements the store task, then the API task that depends on it, producing real typechecked code and a working splice into src/index.ts",
    async () => {
      const { agents, workspacePath, storeTask, apiTask } = await provisionAndDecompose();

      const storeOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
      expect(storeOutcome.status).toBe("COMPLETED");
      if (storeOutcome.status !== "COMPLETED") return;
      expect(storeOutcome.result.typecheckPassed).toBe(true);
      expect(storeOutcome.result.task.status).toBe("COMPLETED");
      expect(storeOutcome.result.filesWritten).toEqual(expect.arrayContaining(["src/store.ts", "tests/store.test.ts"]));

      const storeContent = await readFile(join(workspacePath, "src", "store.ts"), "utf-8");
      expect(storeContent).toContain("export function create(");
      expect(storeContent).toContain("export function list(");

      const apiOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: apiTask.id, startedBy: authActor() });
      expect(apiOutcome.status).toBe("COMPLETED");
      if (apiOutcome.status !== "COMPLETED") return;
      expect(apiOutcome.result.typecheckPassed).toBe(true);
      expect(apiOutcome.result.filesWritten).toEqual(expect.arrayContaining(["src/routes.ts", "tests/routes.test.ts", "src/index.ts"]));

      const indexContent = await readFile(join(workspacePath, "src", "index.ts"), "utf-8");
      expect(indexContent).toMatch(/import \{.*Router.*\} from "\.\/routes\.js";/);
      expect(indexContent).toMatch(/app\.use\("\/api\/.*",.*Router\);/);
      // The original scaffold's own health check must still be intact — a splice, never a rewrite.
      expect(indexContent).toContain('app.get("/health"');

      const runCommand = toolRegistry.get("run_workspace_command");
      expect(runCommand).toBeDefined();
      const testResult = (await runCommand!.execute({ workspacePath, command: "test" }, { agentId: agents.engineeringAgent.id, executionId: "test-verification" })) as { exitCode: number; stdout: string; stderr: string };
      expect(testResult.exitCode, `real vitest run inside the generated workspace should pass:\n${testResult.stdout}\n${testResult.stderr}`).toBe(0);
    },
    { timeout: 60_000 },
  );

  it("refuses to run a task assigned to a different agent", async () => {
    const { agents, storeTask } = await provisionAndDecompose();
    const otherAgent = agents.codeReviewAgent;
    await expect(engineeringAgentService.run({ agentId: otherAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() })).rejects.toThrow(/is assigned to agent/);
  });

  it("refuses to run the API task before its store dependency has completed", async () => {
    const { agents, apiTask } = await provisionAndDecompose();
    await expect(engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: apiTask.id, startedBy: authActor() })).rejects.toThrow(/depends on task/);
  });

  it("refuses to re-run an already-COMPLETED task", async () => {
    const { agents, storeTask } = await provisionAndDecompose();
    const outcome = await engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");

    await expect(engineeringAgentService.run({ agentId: agents.engineeringAgent.id, engineeringTaskId: storeTask.id, startedBy: authActor() })).rejects.toThrow(/only runs a PENDING or FAILED/);
  });
});

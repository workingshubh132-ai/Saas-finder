import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.js";
import { isWorkspaceCommandName } from "../domain/workspace/workspace-path.js";
import { ValidationError } from "../domain/shared/errors.js";
import type { Tool, ToolExecutionContext } from "./tool.js";

const execFileAsync = promisify(execFile);

export const runWorkspaceCommandInputSchema = z.object({
  workspacePath: z.string().min(1),
  command: z.string().min(1),
});
export const runWorkspaceCommandOutputSchema = z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string() });

const EXEC_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 200_000;

/**
 * Resolves each allowed command name to the exact argv it runs — never
 * a shell-interpreted string, so there is no injection surface even in
 * principle (docs/M6_ARCHITECTURE_PROPOSAL.md §13). Every entry
 * invokes VentureForge's OWN already-installed toolchain binary
 * (node_modules/.bin/vitest, .../tsc) with the workspace as cwd,
 * rather than assuming a fresh `npm install` can reach the network
 * from inside this sandbox (§1's own audit finding carried through:
 * the generated workspace is a real filesystem descendant of the repo
 * root specifically so Node's/TypeScript's module resolution walk-up
 * finds VentureForge's own dependencies without a second install).
 */
function resolveCommand(name: string): { bin: string; args: readonly string[] } {
  const binDir = `${config.factoryWorkspacesDir}/../node_modules/.bin`;
  switch (name) {
    case "test":
      return { bin: `${binDir}/vitest`, args: ["run"] };
    case "build":
      return { bin: `${binDir}/tsc`, args: ["-p", "tsconfig.json"] };
    case "typecheck":
      return { bin: `${binDir}/tsc`, args: ["--noEmit"] };
    default:
      throw new ValidationError(`Unknown workspace command: ${name}`);
  }
}

/**
 * The Engineering Agent's only execution capability
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §11, §13) — GREEN because it is
 * confined to a fixed, tiny allowlist of read-only-effect commands
 * (test/build/typecheck) run inside one disposable workspace
 * directory; never an arbitrary shell command.
 */
export class RunWorkspaceCommandTool implements Tool {
  readonly id = "run_workspace_command";
  readonly name = "Run Workspace Command";
  readonly description = "Runs one allowlisted command (test/build/typecheck) inside a factory workspace directory.";
  readonly category = "WORKSPACE" as const;
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["RUN_WORKSPACE_COMMAND"] as const;
  readonly inputSchema = runWorkspaceCommandInputSchema;
  readonly outputSchema = runWorkspaceCommandOutputSchema;

  async execute(rawInput: unknown, _context: ToolExecutionContext): Promise<z.infer<typeof runWorkspaceCommandOutputSchema>> {
    const input = this.inputSchema.parse(rawInput) as z.infer<typeof runWorkspaceCommandInputSchema>;
    if (!isWorkspaceCommandName(input.command)) {
      throw new ValidationError(`Command "${input.command}" is not on the allowlist (test/build/typecheck).`);
    }
    const { bin, args } = resolveCommand(input.command);

    try {
      const { stdout, stderr } = await execFileAsync(bin, args, { cwd: input.workspacePath, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
      return { exitCode: 0, stdout: stdout.slice(0, MAX_OUTPUT_BYTES), stderr: stderr.slice(0, MAX_OUTPUT_BYTES) };
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string; message: string };
      return {
        exitCode: typeof err.code === "number" ? err.code : 1,
        stdout: (err.stdout ?? "").slice(0, MAX_OUTPUT_BYTES),
        stderr: (err.stderr ?? err.message ?? "").slice(0, MAX_OUTPUT_BYTES),
      };
    }
  }
}

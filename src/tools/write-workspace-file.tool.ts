import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveWorkspacePath } from "../domain/workspace/workspace-path.js";
import type { Tool, ToolExecutionContext } from "./tool.js";

export const writeWorkspaceFileInputSchema = z.object({
  workspacePath: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
});
export const writeWorkspaceFileOutputSchema = z.object({ written: z.boolean(), bytes: z.number() });

/**
 * The Engineering Agent's only write capability
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §11, §13) — GREEN because its
 * blast radius is structurally confined to one disposable workspace
 * directory (resolveWorkspacePath's real, adversarially-tested
 * containment check, never trusting relativePath alone). Never writes
 * outside workspacePath even if the caller is compromised — the check
 * happens inside execute(), not upstream of it.
 */
export class WriteWorkspaceFileTool implements Tool {
  readonly id = "write_workspace_file";
  readonly name = "Write Workspace File";
  readonly description = "Writes one file's content inside a factory workspace directory. Refuses any path that would escape the workspace boundary.";
  readonly category = "WORKSPACE" as const;
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["WRITE_WORKSPACE_FILES"] as const;
  readonly inputSchema = writeWorkspaceFileInputSchema;
  readonly outputSchema = writeWorkspaceFileOutputSchema;

  async execute(rawInput: unknown, _context: ToolExecutionContext): Promise<z.infer<typeof writeWorkspaceFileOutputSchema>> {
    const input = this.inputSchema.parse(rawInput) as z.infer<typeof writeWorkspaceFileInputSchema>;
    const target = resolveWorkspacePath(input.workspacePath, input.relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.content);
    return { written: true, bytes: Buffer.byteLength(input.content) };
  }
}

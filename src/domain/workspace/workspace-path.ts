import { isAbsolute, resolve, sep } from "node:path";

/**
 * The real, adversarially-tested containment check behind
 * WRITE_WORKSPACE_FILES (docs/M6_ARCHITECTURE_PROPOSAL.md §13, §36.9)
 * — the single most safety-critical function in M6. Never trusts a
 * relativePath string on its own; always resolves it against the real
 * absolute workspace root and checks the result is still inside it.
 * Rejects absolute paths, `..` traversal (including once resolved,
 * e.g. "a/../../b"), and anything that resolves exactly to the
 * workspace root itself (never a valid file target).
 */
export class WorkspacePathViolationError extends Error {
  constructor(relativePath: string) {
    super(`Path "${relativePath}" escapes the workspace boundary — refused.`);
    this.name = "WorkspacePathViolationError";
  }
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new WorkspacePathViolationError(relativePath);
  }
  const root = resolve(workspaceRoot);
  const resolved = resolve(root, relativePath);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (resolved === root || !resolved.startsWith(rootWithSep)) {
    throw new WorkspacePathViolationError(relativePath);
  }
  return resolved;
}

/**
 * The `allowedFiles` gate on top of workspace containment
 * (EngineeringTask's own scope, §12) — every allowed entry is itself
 * checked through resolveWorkspacePath first, so an allowedFiles entry
 * can never be used to smuggle a traversal past the boundary check.
 */
export function isFileAllowed(workspaceRoot: string, relativePath: string, allowedFiles: readonly string[]): boolean {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  return allowedFiles.some((allowed) => {
    const allowedResolved = resolveWorkspacePath(workspaceRoot, allowed);
    return allowedResolved === target;
  });
}

/**
 * The fixed command-name allowlist behind RUN_WORKSPACE_COMMAND (§13) —
 * never an arbitrary shell string. Deliberately just names here, pure
 * domain logic with no filesystem coupling; the real argv each name
 * resolves to (tools/run-workspace-command.tool.ts) reuses
 * VentureForge's own already-installed toolchain (vitest/tsc) rather
 * than assuming a fresh `npm install` can reach the network from
 * inside this environment — see that file's own docstring.
 */
export const WORKSPACE_COMMAND_NAMES = ["test", "build", "typecheck"] as const;
export type WorkspaceCommandName = (typeof WORKSPACE_COMMAND_NAMES)[number];

export function isWorkspaceCommandName(value: string): value is WorkspaceCommandName {
  return (WORKSPACE_COMMAND_NAMES as readonly string[]).includes(value);
}

import type { Tool } from "./tool.js";

/**
 * In-process, code-defined registry — not a database table. A tool's
 * `execute()` is behavior; representing it as data would mean either
 * storing code-as-data or maintaining a parallel code registry anyway.
 * See docs/M2_ARCHITECTURE_PROPOSAL.md §8/§17.
 */
const tools = new Map<string, Tool>();

export const toolRegistry = {
  register(tool: Tool): void {
    tools.set(tool.id, tool);
  },

  get(id: string): Tool | undefined {
    return tools.get(id);
  },

  list(): Tool[] {
    return [...tools.values()];
  },

  /** Test-only: clears every registration so a test can start from a known-empty registry. */
  clear(): void {
    tools.clear();
  },
};

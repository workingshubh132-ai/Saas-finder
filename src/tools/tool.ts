import type { ZodTypeAny } from "zod";
import type { Permission } from "../domain/permission/permission.js";
import type { RiskLevel } from "../domain/risk/risk-level.js";

export interface ToolExecutionContext {
  readonly agentId: string;
  readonly executionId: string;
}

/**
 * Distinguishes tools with a uniform, round-robin-able input shape
 * (every RESEARCH_SOURCE tool takes the same `{query, maxResults}`,
 * docs/M3_ARCHITECTURE_PROPOSAL.md §3) from tools an agent addresses by
 * name for a specific purpose (WORKSPACE — write_workspace_file/
 * run_workspace_command, docs/M6_ARCHITECTURE_PROPOSAL.md §11). Exists
 * because researchAgentService.run treats "every registered tool" as
 * an interchangeable research source (`toolRegistry.list()` round-
 * robined across planned queries) — without this tag, registering any
 * non-source tool in the same global registry silently breaks that
 * agent the moment its query-planning loop reaches the new tool's id.
 */
export type ToolCategory = "RESEARCH_SOURCE" | "WORKSPACE";

/**
 * A registered capability an agent may be granted access to (M2 brief
 * Part 8). Not generic over input/output types — M2 has exactly one
 * tool, and a registry holding heterogeneous `Tool<In, Out>` values
 * would lose that type safety at the lookup boundary anyway. Each
 * concrete tool validates its own input/output against its own Zod
 * schemas inside execute().
 */
export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: RiskLevel;
  readonly requiredPermissions: readonly Permission[];
  readonly inputSchema: ZodTypeAny;
  readonly outputSchema: ZodTypeAny;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

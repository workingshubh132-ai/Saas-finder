import type { ZodTypeAny } from "zod";
import type { Permission } from "../domain/permission/permission.js";
import type { RiskLevel } from "../domain/risk/risk-level.js";

export interface ToolExecutionContext {
  readonly agentId: string;
  readonly executionId: string;
}

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
  readonly riskLevel: RiskLevel;
  readonly requiredPermissions: readonly Permission[];
  readonly inputSchema: ZodTypeAny;
  readonly outputSchema: ZodTypeAny;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

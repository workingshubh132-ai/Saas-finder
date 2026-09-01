import { z } from "zod";
import type { ResearchSource } from "../sources/research-source.js";
import { checkRateLimit } from "../sources/rate-limiter.js";
import type { Tool, ToolExecutionContext } from "./tool.js";

const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;

export const searchToolInputSchema = z.object({
  query: z.string().min(1).max(300),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).default(DEFAULT_RESULTS),
});

const rawSourceResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string().nullable(),
  publishedAt: z.string().nullable(),
  authorContext: z.string().nullable(),
  sourceGroupKey: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const searchToolOutputSchema = z.object({ results: z.array(rawSourceResultSchema) });

export type SearchToolInput = z.infer<typeof searchToolInputSchema>;
export type SearchToolOutput = z.infer<typeof searchToolOutputSchema>;

/**
 * The generic bridge from a `ResearchSource` (§3, a plain "how do I
 * search X" capability with no notion of permissions/risk/budgets) to
 * the `Tool` interface everything else in the runtime already
 * understands (docs/M3_ARCHITECTURE_PROPOSAL.md §3, §15). Registering
 * a new source is `toolRegistry.register(new SourceSearchTool(new
 * WhateverSource()))` — one line — and it automatically inherits
 * Guardian authorization, budget accounting, retry semantics, and
 * `ToolExecution` audit rows from the unmodified `agentRuntimeService`
 * (docs/AGENT_RUNTIME.md), plus bounded request behavior from the
 * shared rate limiter (docs/M3_ARCHITECTURE_PROPOSAL.md §19).
 */
export class SourceSearchTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["READ_WEB"] as const;
  readonly inputSchema = searchToolInputSchema;
  readonly outputSchema = searchToolOutputSchema;

  private readonly source: ResearchSource;

  constructor(source: ResearchSource) {
    this.source = source;
    this.id = source.id;
    this.name = source.name;
    this.description = `Search "${source.name}" for relevant public content.`;
  }

  async execute(rawInput: unknown, _context: ToolExecutionContext): Promise<SearchToolOutput> {
    const input = this.inputSchema.parse(rawInput) as SearchToolInput;
    checkRateLimit(this.source.id, this.source.rateLimit.requestsPerMinute);

    const results = await this.source.search(input.query, { maxResults: input.maxResults });
    return this.outputSchema.parse({ results }) as SearchToolOutput;
  }
}

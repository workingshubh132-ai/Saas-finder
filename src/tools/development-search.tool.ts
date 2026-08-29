import {
  searchToolInputSchema,
  searchToolOutputSchema,
  type SearchToolInput,
  type SearchToolOutput,
} from "./hacker-news-search.tool.js";
import type { Tool, ToolExecutionContext } from "./tool.js";

/**
 * DEVELOPMENT ONLY — makes no network call. Returns deterministic
 * results derived from the actual query text (so different queries
 * produce different, but always unmistakably fake, output — never
 * presented as a real finding). Shares the real tool's id, input, and
 * output schema so callers cannot tell which implementation is behind
 * the `Tool` interface without inspecting `name`/`description`.
 */
export class DevelopmentSearchTool implements Tool {
  readonly id = "hn_search";
  readonly name = "Hacker News Search (DEVELOPMENT FIXTURE)";
  readonly description = "DEVELOPMENT ONLY — deterministic fixture, no network call. See RESEARCH_TOOL_MODE.";
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["READ_WEB"] as const;
  readonly inputSchema = searchToolInputSchema;
  readonly outputSchema = searchToolOutputSchema;

  async execute(rawInput: unknown, _context: ToolExecutionContext): Promise<SearchToolOutput> {
    const input = this.inputSchema.parse(rawInput) as SearchToolInput;
    const count = Math.min(input.maxResults, 3);

    const results = Array.from({ length: count }, (_, index) => ({
      title: `[DEV FIXTURE] Discussion mentioning "${input.query}" (#${index + 1})`,
      url: `https://dev-fixture.local/hn/${encodeURIComponent(input.query)}/${index + 1}`,
      points: 10 + index * 5,
      author: "dev-fixture-user",
      createdAt: new Date(0).toISOString(),
      snippet: "[DEV FIXTURE] No real search was performed — RESEARCH_TOOL_MODE=development.",
    }));

    return Promise.resolve(this.outputSchema.parse({ results }) as SearchToolOutput);
  }
}

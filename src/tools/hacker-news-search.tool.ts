import { z } from "zod";
import { ToolError } from "../domain/shared/errors.js";
import type { Tool, ToolExecutionContext } from "./tool.js";

const HN_ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 5;
const FETCH_TIMEOUT_MS = 8000;

export const searchToolInputSchema = z.object({
  query: z.string().min(1).max(300),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).default(DEFAULT_RESULTS),
});

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  points: z.number().nullable(),
  author: z.string().nullable(),
  createdAt: z.string().nullable(),
  snippet: z.string().nullable(),
});

export const searchToolOutputSchema = z.object({
  results: z.array(searchResultSchema),
});

export type SearchToolInput = z.infer<typeof searchToolInputSchema>;
export type SearchToolOutput = z.infer<typeof searchToolOutputSchema>;

interface AlgoliaHit {
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  points?: number | null;
  author?: string | null;
  created_at?: string | null;
  _highlightResult?: { title?: { value?: string } };
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

export interface HackerNewsSearchToolOptions {
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The real research tool (M2 brief Part 9): the Hacker News Algolia
 * Search API — public, keyless, explicitly built for programmatic
 * search, so there is no authentication, paywall, CAPTCHA, or
 * robots-disallowed access to bypass. Bounded: capped result count,
 * capped query length, an explicit fetch timeout, no pagination
 * beyond one page. Confirmed the *contract* is real; live connectivity
 * from this sandbox could not itself be verified — hn.algolia.com is
 * blocked by this environment's outbound proxy allowlist (confirmed
 * via a direct curl returning a 403 at the CONNECT step). See
 * docs/M2_ARCHITECTURE_PROPOSAL.md §9 and docs/TOOL_SYSTEM.md.
 */
export class HackerNewsSearchTool implements Tool {
  readonly id = "hn_search";
  readonly name = "Hacker News Search";
  readonly description = "Full-text search over Hacker News stories (Algolia HN Search API).";
  readonly riskLevel = "GREEN" as const;
  readonly requiredPermissions = ["READ_WEB"] as const;
  readonly inputSchema = searchToolInputSchema;
  readonly outputSchema = searchToolOutputSchema;

  private readonly fetchImpl: typeof fetch;

  constructor(options: HackerNewsSearchToolOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async execute(rawInput: unknown, _context: ToolExecutionContext): Promise<SearchToolOutput> {
    const input = this.inputSchema.parse(rawInput) as SearchToolInput;

    const url = new URL(HN_ALGOLIA_SEARCH_URL);
    url.searchParams.set("query", input.query);
    url.searchParams.set("hitsPerPage", String(input.maxResults));
    url.searchParams.set("tags", "story");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { signal: controller.signal });
    } catch (error) {
      throw new ToolError(`Hacker News search request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ToolError(`Hacker News search returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as AlgoliaResponse;
    const results = payload.hits.slice(0, input.maxResults).map((hit) => ({
      title: hit.title ?? hit.story_title ?? "(untitled)",
      url: hit.url ?? hit.story_url ?? null,
      points: hit.points ?? null,
      author: hit.author ?? null,
      createdAt: hit.created_at ?? null,
      snippet: hit._highlightResult?.title?.value ?? null,
    }));

    return this.outputSchema.parse({ results }) as SearchToolOutput;
  }
}

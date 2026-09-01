import { ToolError } from "../domain/shared/errors.js";
import type { RawSourceResult, ResearchSource } from "./research-source.js";

const HN_ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const FETCH_TIMEOUT_MS = 8000;

interface AlgoliaHit {
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  points?: number | null;
  author?: string | null;
  created_at?: string | null;
  objectID?: string;
  _highlightResult?: { title?: { value?: string } };
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

export interface HackerNewsSourceOptions {
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The Hacker News Algolia Search API (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §3, carried over from M2's `HackerNewsSearchTool` —
 * docs/TOOL_SYSTEM.md): public, keyless, explicitly built for
 * programmatic search — no authentication, paywall, CAPTCHA, or
 * robots-disallowed access to bypass. Bounded: capped result count,
 * capped query length (enforced by SourceSearchTool's shared input
 * schema), an explicit fetch timeout, one page, no pagination.
 * Live connectivity from this sandbox is unverified — see
 * docs/TOOL_SYSTEM.md and docs/SOURCE_ADAPTERS.md.
 */
export class HackerNewsSource implements ResearchSource {
  readonly id = "hacker_news";
  readonly name = "Hacker News (Algolia Search)";
  readonly rateLimit = { requestsPerMinute: 30 };

  private readonly fetchImpl: typeof fetch;

  constructor(options: HackerNewsSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]> {
    const url = new URL(HN_ALGOLIA_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("hitsPerPage", String(options.maxResults));
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
    return payload.hits.slice(0, options.maxResults).map((hit) => ({
      title: hit.title ?? hit.story_title ?? "(untitled)",
      content: hit._highlightResult?.title?.value ?? hit.title ?? hit.story_title ?? "",
      url: hit.url ?? hit.story_url ?? null,
      publishedAt: hit.created_at ?? null,
      authorContext: hit.author ?? null,
      // Each result is already its own distinct story (search targets
      // tags=story, not comments) — there is no broader thread to
      // group it under. See docs/SOURCE_ADAPTERS.md.
      sourceGroupKey: null,
      metadata: { points: hit.points ?? null, objectID: hit.objectID ?? null },
    }));
  }
}

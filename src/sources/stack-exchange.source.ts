import { ToolError } from "../domain/shared/errors.js";
import type { RawSourceResult, ResearchSource } from "./research-source.js";

const STACK_EXCHANGE_SEARCH_URL = "https://api.stackexchange.com/2.3/search/advanced";
const DEFAULT_SITE = "stackoverflow";
const FETCH_TIMEOUT_MS = 8000;

interface StackExchangeItem {
  title?: string;
  link?: string;
  creation_date?: number;
  owner?: { display_name?: string };
  tags?: string[];
  score?: number;
  answer_count?: number;
  is_answered?: boolean;
  question_id?: number;
}

interface StackExchangeResponse {
  items?: StackExchangeItem[];
}

export interface StackExchangeSourceOptions {
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Which Stack Exchange site to search (default "stackoverflow"). */
  site?: string;
}

/**
 * Stack Exchange's `/2.3/search/advanced` API
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §3): public, keyless for the
 * anonymous-tier volume this system needs, explicitly documented for
 * programmatic search — same profile as Hacker News Algolia: no
 * authentication, paywall, CAPTCHA, or robots.txt to bypass. The
 * default response has no answer body text, so `content` is
 * constructed from the title and tags actually returned rather than
 * anything invented; a future revision could request a response
 * filter for a real excerpt. Live connectivity from this sandbox is
 * unverified — see docs/SOURCE_ADAPTERS.md.
 */
export class StackExchangeSource implements ResearchSource {
  readonly id = "stack_exchange";
  readonly name = "Stack Exchange (Advanced Search)";
  /** Conservative placeholder — Stack Exchange throttles per-day
   *  without an app key; no live traffic has tuned this value. */
  readonly rateLimit = { requestsPerMinute: 30 };

  private readonly fetchImpl: typeof fetch;
  private readonly site: string;

  constructor(options: StackExchangeSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.site = options.site ?? DEFAULT_SITE;
  }

  async search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]> {
    const url = new URL(STACK_EXCHANGE_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("site", this.site);
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "relevance");
    url.searchParams.set("pagesize", String(options.maxResults));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { signal: controller.signal });
    } catch (error) {
      throw new ToolError(`Stack Exchange search request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ToolError(`Stack Exchange search returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as StackExchangeResponse;
    const items = payload.items ?? [];
    return items.slice(0, options.maxResults).map((item) => ({
      title: item.title ?? "(untitled)",
      content: [item.title ?? "", item.tags && item.tags.length > 0 ? `Tags: ${item.tags.join(", ")}` : ""]
        .filter(Boolean)
        .join(" — "),
      url: item.link ?? null,
      publishedAt: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : null,
      authorContext: item.owner?.display_name ?? null,
      // Each result is its own distinct question — no broader thread
      // to group it under (see docs/SOURCE_ADAPTERS.md, same reasoning
      // as HackerNewsSource).
      sourceGroupKey: null,
      metadata: {
        score: item.score ?? null,
        answerCount: item.answer_count ?? null,
        isAnswered: item.is_answered ?? null,
        questionId: item.question_id ?? null,
        tags: item.tags ?? [],
      },
    }));
  }
}

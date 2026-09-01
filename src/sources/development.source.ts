import type { RawSourceResult, ResearchSource } from "./research-source.js";

export interface DevelopmentSourceOptions {
  /** The real source id this fixture stands in for (e.g. "hacker_news"). */
  standsInFor: string;
  displayName: string;
}

/**
 * DEVELOPMENT ONLY — makes no network call. One generic fixture class
 * standing in for any registered real source (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §3), so adding a new real source doesn't require a matching new
 * fixture class. Returns deterministic results derived from the
 * actual query text (different queries produce different, but always
 * unmistakably fake, output) — the same honesty bar M2 established for
 * `DevelopmentSearchTool` (docs/TOOL_SYSTEM.md), generalized. Shares
 * the real source's `id` (set via `standsInFor`) so a caller cannot
 * tell which implementation is behind `ResearchSource` without
 * inspecting `name`.
 */
export class DevelopmentSource implements ResearchSource {
  readonly id: string;
  readonly name: string;
  readonly rateLimit = { requestsPerMinute: 1000 };

  constructor(options: DevelopmentSourceOptions) {
    this.id = options.standsInFor;
    this.name = `${options.displayName} (DEVELOPMENT FIXTURE)`;
  }

  search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]> {
    const count = Math.min(options.maxResults, 3);
    const results: RawSourceResult[] = Array.from({ length: count }, (_, index) => ({
      title: `[DEV FIXTURE] Discussion mentioning "${query}" (#${index + 1}, via ${this.id})`,
      content:
        `[DEV FIXTURE] No real search was performed — RESEARCH_TOOL_MODE=development. ` +
        `Deterministic placeholder content for query "${query}".`,
      url: `https://dev-fixture.local/${this.id}/${encodeURIComponent(query)}/${index + 1}`,
      publishedAt: new Date(0).toISOString(),
      authorContext: "dev-fixture-user",
      sourceGroupKey: null,
      metadata: { points: 10 + index * 5 },
    }));
    return Promise.resolve(results);
  }
}

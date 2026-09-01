# Source Adapters

M3. How VentureForge actually reaches a public source, and the
compliance boundary every adapter operates inside (M3 brief Part 6-7).
Architecture rationale in `docs/M3_ARCHITECTURE_PROPOSAL.md` §3.

## The `ResearchSource` interface

```ts
interface ResearchSource {
  readonly id: string;
  readonly name: string;
  readonly rateLimit: { requestsPerMinute: number };
  search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]>;
}
```

(`src/sources/research-source.ts`). Deliberately narrower than `Tool`
(`TOOL_SYSTEM.md`) — a source only knows how to search one external
system; it has no notion of permissions, risk, budgets, or audit.
Those stay exactly where M2 put them, via one generic bridge:

```ts
class SourceSearchTool implements Tool {
  constructor(source: ResearchSource) { ... }
  // id = source.id, riskLevel = "GREEN", requiredPermissions = ["READ_WEB"]
  async execute(input, ctx) {
    checkRateLimit(source.id, source.rateLimit.requestsPerMinute);
    return { results: await source.search(input.query, { maxResults: input.maxResults }) };
  }
}
```

(`src/tools/source-search.tool.ts`). Registering a new source is
`toolRegistry.register(new SourceSearchTool(new WhateverSource()))` —
one line — and it automatically inherits Guardian authorization
(`AGENT_RUNTIME.md`), budget accounting, bounded retries, and
`ToolExecution` audit rows from the unmodified `agentRuntimeService`.
No new permission or risk level was needed: `READ_WEB`/`GREEN` already
covers "search a public source" (`DECISIONS.md` #4).

## Rate limiting

`src/sources/rate-limiter.ts` — a small in-memory fixed-window limiter
keyed by source id, consulted by `SourceSearchTool.execute()` before
every `search()` call. Exceeding a source's own declared
`rateLimit.requestsPerMinute` raises a `RateLimitError`, retried under
the same bounded-retry policy as any other transient failure
(`AGENT_RUNTIME.md`) — never a silent drop, never an unbounded wait.
Every adapter additionally keeps its own fetch timeout (8s,
`AbortController`) so one slow request can't quietly exhaust an
execution's `maxDurationMs`.

## Registered sources

### `HackerNewsSource` (real)

`src/sources/hacker-news.source.ts` — the Hacker News Algolia Search
API (`https://hn.algolia.com/api/v1/search`): public, keyless,
explicitly built for programmatic search. No authentication, paywall,
CAPTCHA, or robots-disallowed access to bypass (M3 brief Part 7).
Bounded: capped result count and query length (`SourceSearchTool`'s
shared input schema), 8s timeout, one page, no pagination.
`rateLimit: 30/min`. Carried over from M2's `HackerNewsSearchTool`
(`TOOL_SYSTEM.md`), refactored behind `ResearchSource`.

### `StackExchangeSource` (real)

`src/sources/stack-exchange.source.ts` — Stack Exchange's
`/2.3/search/advanced` API: public, keyless for the volume this system
needs, explicitly documented for programmatic search. Same compliance
profile as Hacker News. The default API response carries no answer
body text, so `content` is built from the title and tags actually
returned — never an invented excerpt. `rateLimit: 30/min` (a
conservative placeholder; Stack Exchange throttles per-day without an
app key, and no live traffic has tuned this number).

**Verification status, stated plainly** (same honesty standard as M2's
`AnthropicModelProvider`/`HackerNewsSearchTool` — `TOOL_SYSTEM.md`):
both adapters' contracts are real and unit-tested against realistic
mocked responses (`fetchImpl` is injectable in both). Live
connectivity from this development sandbox is not verified —
`hn.algolia.com` is confirmed outside this sandbox's outbound proxy
allowlist (a direct `curl` returns 403 at the `CONNECT` step);
`api.stackexchange.com` was not separately probed but is assumed to
sit behind the same allowlist boundary for the same reason. This is a
property of this environment, not of the adapters' implementations.

### `DevelopmentSource` (fixture)

`src/sources/development.source.ts` — one generic fixture class,
parameterized by which real source it stands in for (`standsInFor`),
rather than a separate fixture class per source. Makes no network
call; returns deterministic results derived from the actual query text
— different queries produce different, but always unmistakably
`[DEV FIXTURE]`-labeled, output. Shares the real source's `id` so a
caller cannot distinguish which implementation is behind `ResearchSource`
without reading `name`.

`RESEARCH_TOOL_MODE=development` (the `.env.example` default) registers
`DevelopmentSource` instances standing in for both real sources;
`RESEARCH_TOOL_MODE=live` registers the real `HackerNewsSource` and
`StackExchangeSource` (`src/tools/register-tools.ts`). The automated
test suite runs exclusively in `development` mode — no test depends on
live network (`docs/M3_ARCHITECTURE_PROPOSAL.md` §23).

## Considered and not built

- **Reddit.** Interface-compatible, deliberately not implemented. Reddit's
  official API now requires an OAuth-registered application credential
  this environment has none of; the legacy unauthenticated `.json`
  endpoints are not a legitimate substitute for automated/programmatic
  use at any real volume under Reddit's current API terms. Building
  against them would mean shipping a source that's unsafe to actually
  run in production — the opposite of Part 7's requirement. Adding it
  later is a founder decision (register an app, supply
  `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`) plus one new `ResearchSource`
  file — not an architecture change.
- **Product review sites / generic forums.** Named as "potential," not
  required (M3 brief Part 6), and Part 6/45 both warn against adding
  sources merely to raise the count. Two real, legitimate, keyless
  sources plus a clean extension point already satisfy "multiple useful
  public research sources."

## What every adapter must never do (M3 brief Part 7)

Bypass a CAPTCHA, authentication, or paywall; evade a rate limit or
access control; scrape content that isn't publicly, legitimately
accessible; collect unnecessary personal data. Neither registered
source needs to do any of these — that was the deciding factor in
choosing them. A future adapter that *would* need to is not a
candidate for this registry without first resolving that conflict, not
after.

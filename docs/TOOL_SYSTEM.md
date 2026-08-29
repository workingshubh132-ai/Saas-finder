# Tool System

M2. Gives an agent exactly one kind of capability today — calling a
registered, permission-gated, read-only tool — through the same
Guardian (`authorizationService.authorize()`) that has governed every
other capability since M1. See `M2_ARCHITECTURE_PROPOSAL.md` §8.

## The `Tool` contract

`src/tools/tool.ts`:

```ts
interface Tool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly riskLevel: RiskLevel;
  readonly requiredPermissions: readonly Permission[];
  readonly inputSchema: ZodTypeAny;
  readonly outputSchema: ZodTypeAny;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}
```

Not generic over `<In, Out>` — M2 has exactly one tool, and a registry
of heterogeneous `Tool<In, Out>` values loses type safety at the
lookup boundary anyway (you always look up by `id` at runtime and get
`unknown` back regardless). Each concrete tool validates its own input
and output against its own schemas inside `execute()`; the runtime
(`agent-runtime.service.ts`) independently re-validates both at the
call boundary — see `AGENT_RUNTIME.md`.

## Registry — code, not a database table

`src/tools/tool-registry.ts` is an in-process `Map<string, Tool>`.
Considered and rejected: storing tool definitions as rows
(`M2_ARCHITECTURE_PROPOSAL.md` §17) — a tool's `execute()` is
behavior, and representing behavior as data means either storing
code-as-data (unsafe) or maintaining a parallel code registry anyway
(redundant). What *is* genuinely data — every call a tool made, with
its input/output/timing — is the separate `ToolExecution` table
(`AGENT_RUNTIME.md`).

`registerDefaultTools()` (`src/tools/register-tools.ts`) populates the
registry once at process startup (`src/index.ts`) and once per test
run (`tests/setup.ts`), choosing the implementation from
`RESEARCH_TOOL_MODE`.

## The one real tool: Hacker News search

`src/tools/hacker-news-search.tool.ts` — `id: "hn_search"`, backed by
the **Hacker News Algolia Search API**
(`https://hn.algolia.com/api/v1/search`): public, keyless, and
explicitly built for programmatic search. This was the deciding
factor in choosing it as M2's one real tool — the M2 brief requires
that the research tool "must never bypass authentication, paywalls,
CAPTCHAs, robots.txt, rate limits, or platform restrictions," and this
API has none of those to bypass in the first place; there is no login
wall, no scraping, no header spoofing, no rate-limit evasion.

Bounded by construction, not just by the runtime's own budget:

- `query`: 1–300 characters (`searchToolInputSchema`).
- `maxResults`: 1–10, default 5; only one page is ever requested — no
  pagination loop.
- An 8-second fetch timeout via `AbortController`, so one slow request
  cannot itself exhaust the execution's `maxDurationMs` unnoticed.
- The request URL is built from a **fixed constant**
  (`HN_ALGOLIA_SEARCH_URL`) plus the query string — a caller (agent or
  model output) can influence what is searched *for*, never *where*
  the request goes. There is no caller-suppliable URL parameter
  anywhere in the tool's input schema, so there is no SSRF vector
  through this tool: it cannot be redirected to fetch an
  attacker-chosen internal or external endpoint.
- `riskLevel: "GREEN"`, `requiredPermissions: ["READ_WEB"]` — already
  GREEN under M1's existing, unmodified permission→risk policy
  (`DECISIONS.md` #4); no new risk classification was needed.
- `requiredPermissions` still runs through `authorizationService.authorize()`
  on every single call (`AGENT_RUNTIME.md`) — an agent with no
  `READ_WEB` grant cannot use it, full stop, tested directly
  (`tests/integration/research-agent.test.ts` — "fails closed, no
  opportunity is created").

**Verification status, stated plainly:** the tool's *contract* is
real and unit-tested against realistic mocked Algolia responses
(`fetchImpl` is injectable). Live connectivity from this development
sandbox could not itself be confirmed — a direct `curl` to
`hn.algolia.com` returned a 403 at the proxy's `CONNECT` step, i.e.
this specific host is outside the sandbox's outbound allowlist. That
is a property of this environment, not of the tool's implementation;
nothing about the code assumes or requires this sandbox specifically.
See `M2_ARCHITECTURE_PROPOSAL.md` §9 and the final report.

## The development fixture

`src/tools/development-search.tool.ts` shares the real tool's `id`,
`riskLevel`, `requiredPermissions`, and both schemas — a caller cannot
distinguish which implementation is behind the `Tool` interface
without reading `name`/`description`, both of which are unambiguously
labeled `"... (DEVELOPMENT FIXTURE)"` / `"DEVELOPMENT ONLY — ..."`.
It makes **no network call** and returns deterministic results
*derived from the actual query text* (`[DEV FIXTURE] Discussion
mentioning "<query>" (#n)`), so different queries visibly produce
different fixture output rather than one static canned response — a
choice deliberately made to keep the honesty bar (M2 brief Part 28)
high even in a mode nobody is meant to mistake for a real search.

`RESEARCH_TOOL_MODE=development` is the `.env.example` default; the
automated test suite runs exclusively in this mode (no test depends on
live network — `M2_ARCHITECTURE_PROPOSAL.md` §15).

## Adding a new tool

Not built in M2 (no second tool exists), but the contract is designed
for it: implement `Tool`, pick a real `riskLevel` from the existing
permission→risk table (or extend that table deliberately if the new
capability doesn't map cleanly — a policy decision, `DECISIONS.md` #4),
call `toolRegistry.register()` from `register-tools.ts`, and the
runtime's Guardian check, budget accounting, and `ToolExecution`
audit trail apply automatically with no changes to
`agent-runtime.service.ts`. A **write** tool (files, external
messages, spend) would need the mid-execution-approval-suspension
mechanism this milestone explicitly defers (`AGENT_RUNTIME.md`) before
it could safely sit behind a YELLOW/ORANGE/RED `requiredPermissions`
entry — today such a tool would simply fail closed on every call, per
`callTool`'s `REQUIRES_APPROVAL` handling.

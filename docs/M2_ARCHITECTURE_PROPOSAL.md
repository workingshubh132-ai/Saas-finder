# M2 Architecture Proposal — Agent Execution + Governance Brain

Phase 0 deliverable, written before any M2 implementation, per the M2
brief's own gating rule. This proposal is the plan; `DECISIONS.md` and
the M2 final report record what actually shipped and why anything
here changed during implementation.

## 1. Current M1 architecture assessment

M1 (`3c5783c`) is a layered kernel — `api → services → db/repositories`,
all depending on a pure `domain/` layer — with ten SQLite tables, a
central `authorizationService.authorize()`, an append-only audit log,
an in-process event outbox, and a proven vertical slice (signal →
opportunity → evidence → score → approval → decision queue). It works
and its own tests (70, still green) prove it. Its two most consequential
self-documented gaps, both flagged in `DECISIONS.md`/`SECURITY.md` as
exactly what M2 should fix:

1. **No authentication** — every actor identity is a caller-supplied
   string, checked only against a static `HUMAN_OWNER_IDS` allow-list.
   Real, but not verified.
2. **No agent execution** — `ModelProvider` is a defined-but-unused
   interface; nothing in M1 calls a model or a tool. Evidence and
   Opportunities are created directly by whatever caller supplies
   already-structured data.

M2 exists to close exactly these two gaps, plus formalize the
validation-level policy M1 explicitly deferred (`DECISIONS.md` §9) and
stand up the first real Chairman.

## 2. M1 components reused as-is

- `domain/risk/*`, `domain/permission/*` — risk levels, the
  permission→risk table, `authorize()`'s policy. **Unchanged.**
  `READ_WEB` is already `GREEN`, which is exactly the permission the
  research tool needs — no new permission or risk mapping required.
- `domain/shared/state-machine.ts` — reused for the new
  `AgentExecution` and `ToolExecution` lifecycles, the same way M1
  reused it across Task/Approval/Opportunity/Evidence.
- `authorizationService.authorize()` — reused unmodified as the
  Guardian check inside the agent runtime's tool-call path.
- `evidenceService`, `opportunityService` (scoring, evidence
  attachment) — reused as the landing point for the research
  pipeline's output; extended (not replaced) for the new
  validation-level policy (§8 below).
- `auditService`, `eventBus` — reused unmodified; new action/event
  names are added, no structural change.
- `domain/ports/model-provider.ts` — reused as the exact seam M1 built
  for this purpose (`DECISIONS.md` §13 said this explicitly). One
  additive, optional field (§9 below); no breaking change.
- The whole repository/service/API layering pattern is repeated for
  every new subsystem, not reinvented.

## 3. M1 components that require modification

- **`config.ts` / `HUMAN_OWNER_IDS`** — superseded by the `identities`
  table. The env-list allow-list check is replaced by verified bearer
  tokens. This is a required M2 change (Part 3 of the brief is
  explicit: "do not rely on arbitrary caller-supplied identifiers for
  privileged operations"), not an unnecessary rewrite.
- **Every route currently reading `actorType`/`actorId`/`createdBy`/
  `grantedBy`/`reviewedBy` from the request body**
  (`agents.routes.ts`, `tasks.routes.ts`, `evidence.routes.ts`,
  `opportunities.routes.ts`, `decisions.routes.ts`) — these now read
  the caller's identity from `req.actor` (set by auth middleware),
  not the body. **Zod schemas lose their `actor`/`*By` fields**; route
  handlers pass `req.actor` into the service call instead. Service
  function *signatures* stay the same shape (`actor: {actorType,
  actorId}`, or a plain identity string for human actions) — only
  *where that value comes from* changes, so the services themselves
  need minimal edits.
- **`approvalService.decide` / `agentService.grantPermission` /
  `agentService.createAgent`** — `assertHumanOwner()` now checks
  `req.actor.type === "HUMAN"` (resolved from a verified identity)
  instead of a config allow-list membership test. The
  `SelfApprovalError` defense-in-depth check is kept verbatim — it's
  still correct and now backed by a stronger guarantee (an agent
  literally cannot obtain a HUMAN-type token).
- **`opportunityService.setValidationLevel`** — M1's single "≥1
  evidence" guard is replaced by the full per-level policy (§8).
  Existing behavior for `LEVEL_1` is preserved as a special case of
  the new table, so no M1 test regresses.
- **`decisionQueueService.enrich`** — extended (not rewritten) to also
  attach the opportunity's latest `ChairmanReview`, so the queue shows
  CEO recommendation + Chairman recommendation + Guardian status +
  evidence together, per Constitution §28 / M2 Part 17.
- **`tests/integration/api.test.ts`** — updated to authenticate
  (obtain a bootstrap token) instead of passing body-level actor
  fields; this is expected fallout from §3's auth change, not
  incidental breakage, and is called out here rather than silently
  patched.

## 4. M1 components that remain untouched

`domain/agent`, `domain/task`, `domain/approval`, `domain/evidence`
(types + transitions), `domain/memory`, `domain/events`, `domain/audit`,
all repositories except where a new table needs one, `taskService`,
`memoryRepository`, the Task/Approval/Evidence/Opportunity Prisma
models and their existing columns, `research-intake.service.ts` (kept
as the *manual/direct* intake path — still useful for non-agent-
sourced signals; the new agent-executed path is additive, not a
replacement), and all of M1's documentation content (extended, never
deleted).

## 5. Proposed agent runtime architecture

In-process execution engine, not a distributed worker (that's M3+,
Part 31). `AgentRuntime.execute(executionId)` runs a **fixed, bounded
pipeline** rather than an open-ended "while(true) think/act" loop
(the brief explicitly forbids the latter, Part 21):

```
PLAN            — ModelProvider call: objective -> 1..3 search queries
   ↓
TOOL (×≤3)      — one bounded tool call per query, ≤5 results each
   ↓
SYNTHESIZE      — ModelProvider call: raw results -> ResearchFinding[]
   ↓
PROCESS_RESULT  — Zod + domain validation -> Evidence rows -> Opportunity
   ↓
COMPLETE
```

Every stage is a fixed, numbered step against a **known upper bound**
(at most 1 plan call + 3 tool calls + 1 synthesis call = 5 external
calls per execution) — this is deliberately not a dynamic planner that
decides its own step count. A generic dynamic loop was considered and
rejected (§17, Alternatives).

The runtime is a service (`src/services/agent-runtime.service.ts`),
not a new HTTP framework or job queue — `POST /api/agent-executions`
starts one synchronously (M2's single agent finishes in well under a
second against mocked/dev providers, and the design doesn't preclude
moving to an async queue later without changing the execution record
shape).

## 6. Proposed authentication architecture

New `identities` table: `id, type (HUMAN|AGENT|SYSTEM), label, agent_id?
(FK->agents, only for AGENT), token_hash (SHA-256, unique), token_prefix
(display only), status (ACTIVE|REVOKED), created_by_identity_id?,
created_at, revoked_at?, expires_at?, last_used_at?`.

- A token is a random secret, returned **once** at creation
  (`vf_<random>`), never stored in plaintext — only its hash.
- `Authorization: Bearer <token>` → middleware hashes it, looks up an
  `ACTIVE` (and unexpired) identity, sets `req.actor = { type, id,
  identityId }` (for `AGENT`, `id` is the linked `Agent.id`, so every
  downstream call — `AgentPermission` checks, `Evidence.collectedByAgentId`,
  audit entries — keeps using the same id space M1 already established).
  Missing/invalid/revoked → `401 AUTHENTICATION_ERROR`.
- **Bootstrap**: `POST /api/identities` creates the requested identity
  if the caller is an authenticated `HUMAN`, **or**, only when the
  `identities` table is completely empty, creates the first `HUMAN`
  identity unauthenticated (classic "first user becomes admin"
  pattern) — after that one call, the table is never empty again and
  bootstrap mode never re-opens.
- `requireAuth()` / `requireHuman()` middleware gate routes; every
  privileged M1 endpoint (create agent, grant/revoke permission,
  decide an approval, start an execution, create an identity) now
  requires one of these.
- Explicitly **not** built: password/login flows, JWT signing/rotation,
  OAuth, role hierarchies beyond the three types, session cookies, a
  dashboard. This is "how does a caller prove who it is," nothing more
  — matching Part 3's "keep the first implementation minimal."

## 7. Proposed Chairman architecture

`chairmanService.review({ opportunityId, actor })`: loads the
opportunity, its evidence, its latest score; builds a prompt requiring
the five adversarial questions from Constitution §13/M2 Part 16;
calls `ModelProvider.complete()`; Zod-validates the structured
`ChairmanDecision` response (`decision, reasoning, objections[],
missingEvidence[], confidence, recommendation`); persists a
`ChairmanReview` row; does **not** itself decide the `ApprovalRequest`
— it produces input the Human Decision Queue displays alongside the
CEO's (agent's) own recommendation. See `docs/CHAIRMAN.md` for the
prompt and the dev-mode heuristic that makes "must not automatically
agree" a real, testable property even without a live model (§9, §17).

## 8. Proposed tool architecture

`Tool` interface (`id, name, description, riskLevel, requiredPermissions,
inputSchema, outputSchema, execute(input, ctx)`), a small in-process
`ToolRegistry` (code, not a database table — a tool's `execute` is
behavior, which doesn't belong in a row; see §17 for the alternative
considered), and one real tool: `hn_search`
(`src/tools/hacker-news-search.tool.ts`), backed by the Hacker News
Algolia Search API (`https://hn.algolia.com/api/v1/search`) — public,
keyless, built for exactly this kind of programmatic query, and
already `READ_WEB`/`GREEN` under M1's existing permission policy (no
new risk classification needed). A `DevelopmentSearchTool` fixture
stands in when `RESEARCH_TOOL_MODE=development` (the `.env.example`
default — see §9 for why). Every tool call the runtime makes is
recorded as a `ToolExecution` row (§12) and passes through
`authorizationService.authorize()` first (§18 of the brief; detailed
in §11 below).

## 9. Proposed ModelProvider abstraction

M1's interface is reused unmodified except one additive optional field:

```ts
interface CompletionRequest {
  systemPrompt?: string;
  messages: readonly CompletionMessage[];
  maxOutputTokens?: number;
  /** Used only by DevelopmentModelProvider; a real provider ignores it. */
  devFixtureResponse?: unknown;
}
```

Two implementations:

- **`AnthropicModelProvider`** (`src/providers/anthropic-model-provider.ts`)
  — real, calls `https://api.anthropic.com/v1/messages` via `fetch`
  (no SDK dependency needed for one endpoint), reads `ANTHROPIC_API_KEY`
  / `ANTHROPIC_MODEL` from env. **Verified reachable from this sandbox
  directly** (`curl` to `api.anthropic.com` returned a real `401`, i.e.
  the proxy allowlists it) — but no application-level API key exists
  in this environment, so this path is implemented and unit-tested
  against a mocked HTTP response shaped like the real API, not
  live-exercised here. Using the harness's own Anthropic access for
  the application would conflate two different trust boundaries and
  is deliberately not done.
- **`DevelopmentModelProvider`** — returns `devFixtureResponse` (JSON-
  stringified, with `provider: "development-fixture"` in the result
  metadata) when the caller supplies one, otherwise a generic labeled
  placeholder. It never fabricates a claim to be a real model's
  output; every caller that wants dev-mode to actually validate
  end-to-end constructs its own schema-valid fixture (derived from
  real input data — e.g. the Chairman's dev fixture reasons over the
  opportunity's actual evidence, it isn't a static string).

`createModelProvider()` factory picks based on `MODEL_PROVIDER_MODE`
(`development` default in `.env.example`; `anthropic` for a real
deployment with a key configured).

## 10. Proposed execution lifecycle

Exactly the states the brief names, as one `TransitionTable` (same
utility as every M1 lifecycle):

```
CREATED → QUEUED → RUNNING → WAITING_FOR_TOOL → PROCESSING_RESULT → COMPLETED
RUNNING → FAILED | CANCELLED
WAITING_FOR_TOOL → FAILED
```

`RUNNING` is re-entered from `WAITING_FOR_TOOL` after each tool call
(the runtime moves `RUNNING ⇄ WAITING_FOR_TOOL` once per tool call,
not once total). `COMPLETED`/`FAILED`/`CANCELLED` are terminal.

## 11. Proposed security boundaries

```
Actor (verified identity, §6)
   │
   ▼
Start AgentExecution — requireAuth(); target Agent must be ACTIVE
   │
   ▼
For each tool call:
   Agent → Tool.requiredPermissions → authorizationService.authorize()
      │                                        │
      │                              unknown permission/risk → DENY
      │                              agent lacks active grant → DENY
      │                              GREEN                    → proceed
      │                              YELLOW/ORANGE/RED         → FAIL the
      │                                execution (M2 does not support
      │                                suspending mid-run for approval;
      │                                see §19 Deferred) rather than
      │                                silently proceeding or hanging
      ▼
   Execute tool (bounded time, bounded retries, ToolExecution audited)
   │
   ▼
Model output → Zod schema → domain validation → Evidence/Opportunity write
   │
   ▼
Every step: AuditLog entry (actor, action, resource, risk, result)
```

Fail-closed rules carried over unchanged from M1: unknown permission →
deny, unknown risk level → deny, and now additionally: unresolvable/
invalid/revoked actor identity → deny (401) before any of the above
even runs.

## 12. Proposed database changes

Four new tables, each justified individually (Part 23 warns against
creating every suggested table automatically):

- **`identities`** — required for §6; nothing in M1 can represent it.
- **`agent_executions`** — required for §5/§10; one row per execution,
  carrying status, timestamps, model/tool usage counters, estimated
  cost, output, error. Token/cost usage is tracked as columns on this
  table rather than a separate `model_runs` log — M2 has exactly two
  model-calling call sites (plan+synthesize, and Chairman) per
  execution, so per-call granularity beyond an aggregate count doesn't
  earn its complexity yet (flagged as a reasonable M3 addition if a
  future agent makes many more model calls per run).
- **`tool_executions`** — one row per tool call (audit + observability,
  Part 22); not folded into `agent_executions` because an execution
  can make multiple tool calls and each needs its own timing/input/
  output/error.
- **`chairman_reviews`** — required for §7; one row per review,
  `opportunity_id` FK, looked up by `decisionQueueService` rather than
  adding a FK from `ApprovalRequest` (an opportunity can be reviewed
  before an approval request exists, or reviewed again later).

**Not created**, and why: `tool_definitions` (tools are code, §8);
`execution_budgets` (limits are per-agent-type code config, not
runtime data — see `budget.ts`; usage counters live on
`agent_executions` itself); no new columns on `agents`, `tasks`, or
`approval_requests` (Agent↔Identity is a one-directional FK from
`identities`; Task needs nothing new — "CEO Task" in Part 1's diagram
is an ordinary M1 `Task` a Human assigns to the Research Agent, not a
new entity, since M2 does not implement a reasoning CEO agent, only
Research Agent + Chairman).

## 13. Proposed failure/retry model

Bounded retry (max **2 attempts total**, i.e. one retry) only for:
transient tool/network errors, transient model-provider errors
(timeout/5xx), and one schema-validation retry with a corrective
follow-up prompt. **Never** retried: authorization denials, input
validation errors, budget-exceeded — these are not transient and
retrying would either be pointless or actively unsafe. Retries count
against the execution's bounded step budget so a flaky dependency
still cannot loop indefinitely.

## 14. Proposed observability

Every `AgentExecution` row alone answers most of Part 22's question
list (agent, task, model, timing, output/error, cost); `ToolExecution`
rows answer "which tools, how many calls, what input/output"; the
existing `AuditLog` (unchanged) answers "what permissions were
checked" (`AUTHORIZE:*` actions) and "what decisions were made"
(`APPROVAL_*`, plus new Chairman-related actions). No new logging
subsystem — this is the same append-only-log pattern M1 already
built, applied to two new tables. Secrets (API keys, bearer tokens)
are never written to any of these tables — audit metadata for identity
actions stores `token_prefix` only, never the token or its hash.

## 15. Proposed testing strategy

Same split as M1: `tests/unit/*` for pure logic (validation-level
policy evaluation, execution/tool state transitions, budget checks,
dev-fixture builders), `tests/integration/*` for each new subsystem
against the real SQLite test database, and one new end-to-end test
(`tests/integration/m2-end-to-end.test.ts`) mirroring Part 27 exactly.
**No automated test depends on live network or a live model** — both
the search tool and the model provider run in `development` mode
throughout the suite, exactly as M1 already established for its own
external-dependency-free testing. M1's existing 70 tests must stay
green after the auth change (§3); `api.test.ts` is updated to
authenticate, not skipped.

## 16. Risks

- **Auth change touches every M1 route.** Mitigated by keeping service
  signatures stable and only changing where the actor value is
  sourced from; M1's test suite is the regression gate.
- **Real provider/tool code is unexercised live in this sandbox**
  (confirmed: `api.anthropic.com` reachable but no key configured;
  `hn.algolia.com` blocked by this sandbox's proxy allowlist).
  Mitigated by unit-testing both against response fixtures shaped
  like the real, documented APIs, and by being explicit in every
  relevant doc about what was and wasn't live-verified.
- **Chairman-in-dev-mode could look like theater** (a second rubber
  stamp) if built carelessly. Mitigated by deriving its dev-mode
  output from the opportunity's actual evidence (different inputs
  produce different objections/recommendations — tested directly).
- **Scope**: this brief is the largest yet. Mitigated by a hard scope
  line (§18/§19) and by reusing M1 wherever the brief doesn't
  explicitly require a change.

## 17. Alternatives considered

- **JWT/session auth** vs. opaque DB-backed bearer tokens → opaque
  tokens: instant revocation with no blacklist, no signing-key
  lifecycle, simplest thing that is still real authentication.
- **Dynamic multi-step agent planner** (model decides how many steps/
  tool calls to take) vs. a fixed bounded pipeline → fixed pipeline:
  Part 21 explicitly warns against unrestricted loops; a fixed,
  numbered pipeline has a provable upper bound on external calls
  without needing a separate step-limit enforcement mechanism layered
  on top of a dynamic planner. Dynamic planning is deferred (§19).
- **Tool definitions as database rows** vs. code — rejected: a tool's
  `execute()` is behavior; representing it as data would mean either
  storing code-as-data (unsafe) or maintaining a parallel code
  registry anyway (redundant). `ToolExecution` (the audit trail) is
  the part that's genuinely data, and that is a table.
- **Schema-hint-driven generic dev-fixture generator** (pass a JSON
  Schema, auto-fill a dummy) vs. caller-supplied fixture value →
  caller-supplied: avoids a new dependency and a generic "guess a
  valid dummy from a schema" library, keeps domain knowledge (what a
  *good* fixture looks like) where it already lives.

## 18. Exact M2 scope

Bearer-token authentication (HUMAN/AGENT/SYSTEM) with bootstrap, wired
across all privileged endpoints; a bounded in-process agent runtime
with the specified lifecycle, budgets, and bounded retries; a
provider-agnostic `ModelProvider` with a real Anthropic adapter and a
labeled development adapter; a `Tool` system with one real read-only
research tool (HN Algolia) and a labeled development fallback, gated
by the existing Guardian/`authorize()`; one Research Agent producing
Zod-validated structured findings; an explicit finding→evidence→
opportunity-candidate pipeline; a formal, enforced validation-level
policy for LEVEL_0–LEVEL_8; a Chairman that performs and persists
structured adversarial review and feeds (never replaces) the Human
Decision Queue; execution cost/step/time/retry budgets; the new API
surface actually needed for the above; and the full test/doc/security-
review set the brief requires.

## 19. Explicitly deferred to M3+

Everything Part 31 names verbatim (autonomous outbound sales/email/
social DMs, payment processing, real financial spending, external
account creation, automatic SaaS deployment, multi-business portfolio
automation, self-modifying agents, large-scale distributed workers,
complex vector memory, multi-region infrastructure) — plus, specific
to the choices above: mid-execution suspension for a non-GREEN tool
(today such a tool call fails the execution rather than pausing for
approval); a dynamic/open-ended agent planning loop; more than one
agent type; a reasoning CEO agent; per-model-call granular telemetry
(`model_runs`); amount-tiered `SPEND_MONEY` risk policy; JWT/OAuth/
dashboard-user authentication; DB-level (vs. application-level) audit
immutability (still a SQLite limitation, still tracked in
`DECISIONS.md`).

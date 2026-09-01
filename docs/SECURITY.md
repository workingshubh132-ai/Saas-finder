# Security

> **M2 note:** this document's original content (below) is M1's threat
> model, kept verbatim as a historical record — nothing in it has been
> deleted or rewritten. M2 closed the "no authentication" gap it
> documents and added a real agent-execution attack surface; **see the
> "M2 — Agent Execution + Governance Brain" section** for what changed,
> what's new, and the 12-category threat review the M2 brief requires.
> Sections below marked *(superseded in M2 — see the M2 section)*
> describe an M1 mechanism M2 replaced; they're kept for history, not
> as current behavior.
>
> **M3 note:** M3 adds a real external-content pipeline — multiple
> research sources, four new reasoning agents consuming that content,
> and an autonomous-ish orchestration loop (`researchCycleService`).
> **See the "M3 — Opportunity Intelligence Engine" section at the very
> end of this file** for the 12-category threat review the M3 brief
> requires. Nothing in the M1 or M2 sections is superseded by M3.

## Threat model for M1

M1 is a **single-tenant, trusted-caller backend**. It is designed to
be run by its founder (directly, or through internal automation they
control), not exposed to the public internet or to untrusted callers.
Everything below assumes that deployment boundary; widening it is a
"decision requiring founder approval" (see the M1 engineering report),
not something to do silently.

## No authentication — a documented decision, not an oversight *(superseded in M2 — see the M2 section)*

M1 ships with **no login system**. Every service call and HTTP
endpoint takes the acting identity as an explicit, caller-supplied
parameter (`actorType`/`actorId`, or `createdBy`/`grantedBy`/`reviewedBy`
for Human-Owner actions) — it is asserted, not verified against
credentials.

This was a deliberate choice under M1's own instructions ("if
authentication is not yet needed for the chosen MVP architecture,
document that decision rather than inventing an insecure placeholder"):
a fake login system would be strictly worse than none — it would
imply a security boundary that doesn't exist. Before this kernel is
reachable by anyone other than its founder, it needs a real
authentication layer (e.g. signed session tokens resolving to a Human
Owner or Agent identity) sitting in front of `actorId`, so that field
stops being self-reported. **Do not deploy M1 behind a public
endpoint without adding this.**

## Authorization

`authorizationService.authorize({ agentId, action, ... })`
(`src/services/authorization.service.ts`) is the single path for "is
this agent allowed to do this right now?":

1. Unknown `action` (not one of the 11 `Permission` values) → **DENIED**, fails closed.
2. Unknown or non-`ACTIVE` agent → **DENIED**, fails closed.
3. No active `AgentPermission` grant for that action → **DENIED**.
4. Otherwise, the action's risk level decides: GREEN → **ALLOWED**;
   YELLOW/ORANGE/RED → **REQUIRES_APPROVAL**.

Every call is audited regardless of outcome (`AuditLog` with
`result = DENIED` or `SUCCESS`).

## Permission grants are explicit and human-gated *(mechanism updated in M2 — see the M2 section)*

- Creating an agent, granting a permission, and revoking a permission
  all require `assertHumanOwner()` — the caller-supplied identity must
  be in the `HUMAN_OWNER_IDS` allow-list (`src/config.ts`). No agent id
  is ever placed in that list by the system. **(M1 mechanism; M2
  replaced the allow-list check with a verified bearer-token identity
  check — same rule, stronger enforcement. See the M2 section.)**
- **An agent cannot grant itself a permission.** This is enforced
  structurally (the grant endpoint only accepts a recognized Human
  Owner identity), tested directly in
  `tests/integration/authorization.test.ts` and
  `tests/integration/api.test.ts`.
- **A requester cannot approve its own ApprovalRequest.** Enforced
  two ways: `approvalService.decide` requires a Human Owner identity
  (an agent id is never one), *and* independently rejects any decision
  where `reviewedBy === request.requestedByAgentId`. The second check
  is deliberately redundant — `tests/integration/approvals.test.ts`
  proves it by simulating the should-never-happen case where the two
  id spaces collide, to show the guard is real rather than incidental.

`config.assertConfigValid()` refuses to start the process at all if
`HUMAN_OWNER_IDS` is empty — fail closed on missing configuration,
not "run with no one able to approve anything."

## Input validation

Every HTTP body is parsed and rejected-or-typed by a Zod schema before
it reaches a service (`validateBody` middleware,
`src/api/middleware/validate.ts`); route params are read through
`requireParam()`, never a raw possibly-`undefined` index. Every
service additionally re-validates its own domain invariants
(`isRiskLevel`, `isPermission`, `isAgentStatus`, etc.) rather than
trusting the caller — services are called directly in tests and from
other services, not just from HTTP, so the API layer's validation is
not the only line of defense.

## Fail-closed enums, in the database too

SQLite has no native enum type (`prisma validate` rejects one
outright on this connector), so every enum-like column is a `String`.
To avoid relying on application code alone, the initial migration
(`prisma/migrations/20260828153218_init/migration.sql`) adds a SQLite
`CHECK` constraint to every enum-like and bounded-numeric column
(status fields, risk levels, permissions, source types, reliability,
verification status, actor type, audit result, and every 0..1 score/
confidence field). An attempt to write an invalid value fails at the
database layer even if some future code path skipped the TypeScript
guards.

## SQL injection / query safety

All data access goes through Prisma's generated client
(`src/db/repositories/*.ts`) — parameterized queries throughout, no
raw SQL string concatenation anywhere in the application.

## Secrets

No secret is hardcoded anywhere in the repository. `.env` is
git-ignored; `.env.example` documents every variable with no real
values. The only "secret-shaped" thing M1 has today is
`HUMAN_OWNER_IDS`, which is an identity allow-list, not a credential —
knowing a name in that list grants nothing without also controlling
the process's environment.

## Audit log integrity

`src/db/repositories/audit.repository.ts` exports only `record` (insert)
and `list` (read) — no update, no delete — so nothing in the
application can rewrite history. This is enforced at the application
layer only in M1: SQLite has no per-table grant system to make this a
database-level guarantee the way a Postgres role with `INSERT`-only
privileges could. That gap is recorded here rather than silently
assumed away — closing it is part of the Postgres migration in
`DECISIONS.md`.

## Least privilege by default

- A newly created Agent starts with **zero** permission grants — every
  capability, even ones implied by the Constitution's GREEN examples,
  must be explicitly granted by a Human Owner.
- `RiskPolicy` treats an unrecognized risk level or permission as
  denied, never as "assume the safest existing level" — an unknown
  value is a bug to surface, not a default to guess.

## Dependency posture

`npm audit --omit=dev` reports **zero** vulnerabilities in production
dependencies. The handful of advisories `npm audit` reports overall
are in transitive dev/lint tooling only (not shipped, not on the
runtime path) and were not chased further in M1.

---

## M2 — Agent Execution + Governance Brain

Everything below is new in M2. It does not delete or reinterpret
anything above except where explicitly marked *(superseded in M2)* —
this section is additive: M2 closes M1's two self-documented gaps
(no authentication; no agent execution, `DECISIONS.md` #11/#13) and
then has to secure the new surface that agent execution itself opens.

### Authentication — M1's gap, closed

M1 shipped with no login system by design, with an explicit warning
not to expose it beyond its founder without adding real
authentication first (see above). M2 adds that layer:

- **`identities` table**: `type` (`HUMAN`/`AGENT`/`SYSTEM`), a SHA-256
  `token_hash` (unique), a display-only `token_prefix`, `status`
  (`ACTIVE`/`REVOKED`), optional `expires_at`. A token is a random
  32-byte secret (`vf_<base64url>`, `src/domain/shared/tokens.ts`),
  shown to the caller **exactly once**, at creation — never stored in
  plaintext, never re-returned by any later endpoint (`identities.routes.ts`
  explicitly constructs its list/detail responses without the raw
  token, only `tokenPrefix`).
- **`requireAuth()`/`requireHuman()`** (`src/api/middleware/authenticate.ts`)
  resolve `Authorization: Bearer <token>` → hash → identity lookup →
  `req.actor = { type, id, identityId }`, and gate every privileged M1
  and M2 endpoint. A missing/invalid/revoked/expired token is
  `401 AUTHENTICATION_ERROR`; a validly-authenticated but wrong-type
  actor (e.g. an `AGENT` calling a `requireHuman()` route) is
  `403 AUTHORIZATION_ERROR` (`NotHumanOwnerError`) — deliberately
  distinct status codes, since the second case is "we know exactly who
  you are, and you're not allowed," not "we don't know who you are."
- **Bootstrap, and why it can't be exploited to re-open**: `POST /api/identities`
  allows one unauthenticated call — creating the very first `HUMAN`
  identity — only when `identityRepository.countAll() === 0`
  (`identityService.createIdentity`). The instant that call succeeds,
  the table is non-empty forever; every subsequent call (including a
  hypothetical attempt to create a *second* "first" identity) requires
  an authenticated `HUMAN` caller. There is no delete-all-identities
  endpoint, so this path cannot be artificially re-triggered by an
  attacker short of direct database access — which is already outside
  this application's trust boundary.
- **`AGENT` identities require a human and a real agent**: `identityService.createIdentity`
  rejects an `AGENT`-type request unless the caller is an authenticated
  `HUMAN` *and* `agentId` names an `Agent` row that already exists.
  There is no path that mints an agent credential without a human
  first having created that agent (`assertHumanActor`, unchanged since
  M1) through the ordinary, audited `POST /api/agents`.
- Explicitly **not** built, matching "keep the first implementation
  minimal": password/login flows, JWTs, OAuth, role hierarchies beyond
  the three identity types, session cookies, a dashboard. Opaque
  DB-backed tokens were chosen over JWTs specifically because
  revocation is then a single `UPDATE` with no blacklist and no
  signing-key lifecycle to manage (`M2_ARCHITECTURE_PROPOSAL.md` §17).

### Agent impersonation — closing the body-supplied-identity hole

Every M1 route that used to read `actorType`/`actorId`/`createdBy`/
`grantedBy`/`reviewedBy`/`collectedByAgentId` **from the request
body** now reads the caller's identity from `req.actor`, set only by
`requireAuth()`/`requireHuman()` from a verified token — Zod schemas
for these routes no longer even accept an actor field, so there is
nothing for a malicious body to override.

That alone stops a caller from *claiming* to be someone else for
audit/attribution purposes, but several M1 fields still *name* an
agent as data (`collectedByAgentId`, `requestedByAgentId`, etc.) —
without an extra check, an authenticated `AGENT` could submit evidence
or request approval "attributed to" a *different* agent it doesn't
control, muddying the audit trail even though the request itself was
authenticated. `evidence.routes.ts`, `opportunities.routes.ts`
(`:id/request-approval`), and `research-signals.routes.ts` each add:

```ts
if (actor.type === "AGENT" && body.<agentIdField> !== actor.id) {
  throw new AuthorizationDeniedError(...);
}
```

A `HUMAN`/`SYSTEM` caller is unrestricted here (recording evidence "on
behalf of" an agent, e.g. from manual intake, is legitimate and
predates M2); only an `AGENT` identity is locked to attributing
actions to itself. Not currently needed on `evidence/:id/verification`
or `opportunities/:id/status` — those don't take an agent-identifying
body field at all, so there is nothing to spoof there in the first
place.

### Self-approval — extended, not weakened

M1's dual guard is unchanged and still enforced: `approvalService.decide`
requires a `HUMAN` actor *and* independently rejects
`reviewedBy.actorId === request.requestedByAgentId`
(`SelfApprovalError`). M2 makes the first half of that guarantee
categorically stronger: in M1, "human" meant "string is in an env-var
allow-list"; in M2 it means "holds a token for an identity whose
`type` is `HUMAN`," and **no code path exists that mints a `HUMAN`-type
identity for an agent** (`identityService.createIdentity`'s bootstrap
and human-authenticated-creation paths are the only two ways a
`HUMAN` identity is ever created, and neither takes an `agentId`).

Extended to the new execution surface: an `AgentExecution`'s
`startedByIdentityId` records *who started the run* for audit purposes
only — it grants nothing. Every tool call inside that execution is
authorized against the *executing agent's own* permission grants
(`AGENT_RUNTIME.md`), never the starting human's. A human starting a
research run cannot thereby lend the agent any capability the agent
wasn't already, separately, granted.

### Secrets

Unchanged principle from M1 (no secret hardcoded; `.env` git-ignored;
`.env.example` has no real values), extended to two new secret shapes:

- **Bearer tokens**: only the SHA-256 hash and a 10-character display
  prefix are ever persisted (`tokens.ts`); the plaintext token exists
  only in the single HTTP response that creates it and is never
  logged, never included in any audit metadata (`identityService`'s
  audit calls record `type`/`bootstrap` only), and never returned by
  `GET /api/identities`, `GET /api/identities/me`, or the revoke
  endpoint.
- **`ANTHROPIC_API_KEY`**: read from process env only
  (`AnthropicModelProvider`), never persisted to any table, never
  included in an `AgentExecution` row (which stores `modelProvider`/
  `modelName` — descriptive strings — never credentials), never logged.
- Error responses (`error-handler.ts`) return `{ error, errorCode, message }`
  built only from a `DomainError`'s own deliberately-worded `message`;
  any non-`DomainError`/non-`ZodError` exception is logged server-side
  with `console.error` but returns a **generic** `"Unexpected server
  error"` to the caller — no stack trace, no raw exception message,
  and therefore no accidental leak of an internal path, query, or
  credential value through a 500 response.

### The 12-category review (M2 brief Part 29)

1. **Prompt injection.** Search-result content (titles/snippets from
   `hn_search`) reaches the model only inside a user-role message's
   JSON payload during the SYNTHESIZE step
   (`research-agent.service.ts`) — never as a system instruction, and
   the tool the pipeline calls is a hardcoded constant
   (`RESEARCH_TOOL_ID`), not something injected content could redirect.
   *Mitigated:* the pipeline's shape (which tool runs, how many calls,
   what happens to the output) cannot be altered by model output —
   only the *content* of fields inside the fixed output schema can be
   influenced, and every one of those fields lands as an `UNVERIFIED`
   `Evidence` row that still has to clear scoring, Chairman review, and
   a human decision before it means anything. *Remaining risk:* no
   explicit injected-instruction detection/filtering runs over tool
   results before they reach the model; a sophisticated injected claim
   could still produce a misleadingly-worded (but schema-valid, always
   `UNVERIFIED`) finding that a human reviewer has to catch. Flagged
   for M3, not solved here.
2. **Tool abuse.** The one tool is read-only, has a fixed target URL
   (no caller-suppliable destination — no SSRF vector), and is bounded
   on query length, result count, and timeout (`TOOL_SYSTEM.md`).
   *Remaining risk:* none identified for the current tool; a future
   write-capable tool would need the mid-execution-approval mechanism
   this milestone defers (`AGENT_RUNTIME.md`) before it could safely
   exist behind a non-GREEN permission.
3. **Privilege escalation.** Grant/revoke still human-only
   (`assertHumanActor`); `authorize()` is re-checked on every tool
   call, not cached, so a mid-flight revocation takes effect
   immediately; an `AGENT` identity can never be minted without a
   pre-existing, human-created `Agent` row. *Remaining risk:* none
   identified beyond what M1 already carried (a compromised `HUMAN`
   token is still the root trust anchor, same as a compromised
   `HUMAN_OWNER_IDS` entry was in M1).
4. **Agent impersonation.** Closed as described above — actor identity
   comes only from a verified token, never a request body, and the
   agent-attribution guard stops a valid `AGENT` token from acting
   "as" a different agent. *Remaining risk:* none identified.
5. **Self-approval.** M1's dual guard preserved and strengthened as
   described above, extended to execution start/tool-authorization.
   *Remaining risk:* none identified.
6. **Secret exposure.** Tokens hashed at rest, shown once; API keys
   env-only; error responses never carry stack traces or raw
   exceptions (see Secrets above). *Remaining risk:* server-side
   `console.error` logging of unexpected errors could still write a
   sensitive value to process logs if a future exception message ever
   embedded one — no different from any Node service; not specific to
   M2, not separately mitigated beyond "don't put secrets in thrown
   error messages," which every current error class already respects.
7. **Unbounded execution.** Hard budgets on steps/tool calls/model
   calls/duration, checked before every external call, no recursive or
   self-spawning execution, bounded retries only on genuinely transient
   errors (`AGENT_RUNTIME.md`). *Remaining risk:* none identified for
   the current fixed-pipeline agent; a future dynamic planner would
   need its own step-generation bound reviewed before shipping.
8. **Runaway cost.** `maxModelCalls`/`maxToolCalls` cap external call
   count; `maxOutputTokens` caps worst-case response size per call.
   *Remaining risk, stated plainly:* `estimatedCostUsd`/token columns
   exist on `AgentExecution` but are not yet populated from a real
   Anthropic response's usage data, and there is no `maxCostUsd`
   budget enforced independently of call count — today's protection is
   "bounded number of bounded-size calls," not "bounded dollars."
   Acceptable for M2 because the only real-provider path
   (`AnthropicModelProvider`) is not live-exercised in this
   environment and no automated spend occurs anywhere in the system
   (Constitution's Capital Discipline, `SPEND_MONEY` is `RED` and
   unimplemented as an actuator); flagged as a required addition
   before a real deployment runs with a live model key attached to a
   billing account. See `AGENT_RUNTIME.md`.
9. **Malicious/misleading research content.** Nothing from a tool or
   model call is trusted as ground truth: every finding becomes
   `UNVERIFIED` evidence, scoring is a deterministic function of
   confidence/relevance (not model-asserted), the Chairman is required
   to raise objections (never zero), and no automatic action (spend,
   external message, deployment) is ever taken on research content
   alone — every path terminates at the Human Decision Queue.
   *Remaining risk:* a human could still be misled by a
   plausible-sounding fabricated finding if they skip reading the
   Chairman's objections; this is a human-process risk the system
   surfaces evidence for but cannot fully close by itself.
10. **External URL / tool-result handling.** `sourceReference` URLs
    from search results are stored as opaque strings on `Evidence` —
    nothing in the application ever fetches, renders, or re-requests
    them. Only `hacker-news-search.tool.ts` itself calls `fetch`, and
    only against its own fixed endpoint. *Remaining risk:* none
    identified; a future feature that *does* dereference a stored
    `sourceReference` (e.g. a UI preview) would need its own SSRF
    review at that time.
11. **Database tampering.** Unchanged mechanism from M1 (Prisma
    parameterized queries throughout; no raw SQL string concatenation
    anywhere), extended with SQLite `CHECK` constraints on every new
    enum-like/bounded column in the M2 migration (`identities.type`/
    `status`, `agent_executions.status`/`error_code`,
    `estimated_cost_usd >= 0`, `chairman_reviews.decision`,
    `confidence` 0–1). FK `onDelete` policies are chosen deliberately
    per relationship (e.g. `AgentExecution.agentId` is `Restrict` — an
    agent with execution history cannot be deleted out from under it;
    `ToolExecution.executionId` is `Cascade` — a tool-call record has
    no meaning without its parent execution).
12. **Audit log manipulation.** Unchanged mechanism from M1
    (`audit.repository.ts` exports only `record`/`list`, still no
    update or delete path anywhere in the application), extended with
    new action names (`START_AGENT_EXECUTION`,
    `AGENT_EXECUTION_COMPLETED`/`FAILED`, `CHAIRMAN_REVIEW_<decision>`,
    `CREATE_IDENTITY`, `REVOKE_IDENTITY`). *Remaining risk, carried
    over unchanged from M1:* this is still an application-layer
    guarantee only — SQLite has no per-table grant system to make
    "audit log is append-only" a database-level guarantee. Not
    re-solved in M2; still tracked as the same Postgres-migration item
    in `DECISIONS.md`.

### Least privilege — unchanged, reaffirmed under execution

A newly created `Agent` still starts with zero grants (M1, unchanged).
The runtime's `callTool` re-checks `authorize()` on every single call
rather than once per execution, so "least privilege" holds
continuously through a run, not just at its start.

### Dependency posture (M2)

`npm audit --omit=dev` still reports **zero** vulnerabilities in
production dependencies after adding M2's code (no new production
dependency was introduced — `AnthropicModelProvider` and
`HackerNewsSearchTool` both use the global `fetch`, not an SDK).

---

## M3 — Opportunity Intelligence Engine

Everything below is new in M3. Additive to the M2 section above: M3's
real new surface is a genuine external-content pipeline (multiple
research sources feeding four new reasoning agents) and an
orchestration loop that runs many agent executions per call
(`researchCycleService`). No new authentication mechanism, no new
permission, no new risk level — every new tool call is still
`READ_WEB`/GREEN, still passes through the unmodified `authorize()`
Guardian check (`AGENT_RUNTIME.md`, `SOURCE_ADAPTERS.md`).

### Treat all external research content as untrusted data — a real, enforced boundary, not just a policy statement

Every prompt in M3 keeps the same structural separation M2 already
established: `systemPrompt` is always a hardcoded, named constant
(`PLAN_SYSTEM_PROMPT`, `PROBLEM_ANALYST_SYSTEM_PROMPT`,
`COMPETITOR_ANALYST_SYSTEM_PROMPT`, `MARKET_ANALYST_SYSTEM_PROMPT`,
`OPPORTUNITY_ANALYST_SYSTEM_PROMPT`, `CHAIRMAN_SYSTEM_PROMPT`) — never
dynamically built from signal/tool/source content — while every piece
of external content (signal titles/content, search-tool JSON output,
competitor observations) flows only through the `messages` array's
`user`-role content. This is directly verifiable, not just asserted:
`grep -n "systemPrompt:" src/services/*.ts` shows every one of the six
agent/Chairman prompts assigned from a named constant, none built by
string-concatenating request-time content. A model is therefore never
handed external content in a position where it could be mistaken for
an instruction from VentureForge itself.

### The 12-category review (M3 brief Part 36)

1. **Prompt injection through research content.** Mitigated by the
   trust-boundary separation above. *Remaining risk:* within the
   `messages` content itself, a sufficiently adversarial signal/search
   result could still try to influence a real model's *word choice*
   inside its structured JSON output (e.g. a misleading `claim` or
   `reasoning` string) — the schema still constrains the *shape* of
   what comes back (Zod-validated, same `completeWithValidation`
   pattern as M2), but not the semantic content of a free-text field.
   Every such field lands as `UNVERIFIED` Evidence or an unpromoted
   Problem, still subject to Chairman review and a human decision —
   the blast radius stays "a misleading claim a human has to catch,"
   never "the system takes an unauthorized action." No
   content-based instruction-detection filter is implemented; flagged
   for M4, same as M2's equivalent item.
2. **Malicious URLs.** `sourceReference` values from every source are
   stored as opaque strings and never re-fetched, never rendered as
   HTML, never used to construct a further outbound request — carried
   over unchanged from M2's identical finding. Only
   `HackerNewsSource`/`StackExchangeSource` themselves call `fetch`,
   and only against their own fixed, hardcoded endpoint constants —
   no tool accepts a caller-suppliable destination URL, so there is no
   SSRF vector through any M3 tool.
3. **Malicious search results.** Every result is Zod-validated
   (`searchToolOutputSchema`) before it reaches any agent; a
   malformed/oversized field is rejected at that boundary, not passed
   through. Content length isn't hard-capped beyond what the source
   API itself returns, but every downstream consumer (signal quality
   scoring, model prompts) treats it as plain text, never executed or
   templated.
4. **Poisoned evidence.** Nothing is trusted as ground truth anywhere
   in the pipeline: every signal becomes `UNVERIFIED` evidence at best
   (`SIGNAL_MODEL.md`), scoring dimensions are Zod-bounded 0..1 and
   independently reviewed by the Chairman (`OPPORTUNITY_INTELLIGENCE.md`),
   and `evidenceCount`/independence figures are computed from real
   database rows, never trusted from a model's own self-report
   (`problem-analyst.service.ts`'s clamping, §7 of `SIGNAL_MODEL.md`).
   A single poisoned signal can distort one cluster's confidence at
   most — it cannot itself create an Opportunity, approve anything, or
   spend anything.
5. **Instruction injection.** Same mitigation and same remaining risk
   as #1 — this is the same threat from the model-input angle rather
   than the human-facing-claim angle. The structural separation is
   what prevents injected content from being *treated* as an
   instruction by the runtime itself (no tool call, no budget change,
   no permission change can result from prompt content, since none of
   those are ever derived from model output — they're fixed code
   paths).
6. **Data exfiltration.** No M3 tool can write anywhere — every
   registered source is read-only search. No agent has
   `SEND_EXTERNAL_MESSAGE`, `CREATE_EXTERNAL_ACCOUNT`, or any
   write-capable permission. `authorContext` (a source's own author
   label) is stored as opaque text and never resolved to, combined
   with, or cross-referenced against any other personal-data source —
   there is nothing in M3's code path that could turn collected public
   post text into an exfiltration channel for anything sensitive,
   because nothing sensitive (secrets, other users' data) is ever
   placed where a research agent's prompt or tool output could reach
   it in the first place.
7. **Tool abuse.** Every source is read-only, rate-limited
   (`SOURCE_ADAPTERS.md`), and Guardian-gated on every single call, not
   cached (`AGENT_RUNTIME.md`). *Remaining risk:* none identified for
   the two current sources; any future write-capable tool needs the
   mid-execution-approval-suspension mechanism this milestone still
   defers before it could safely exist.
8. **Rate-limit abuse (against the external source, or by the system
   against itself).** `checkRateLimit()` enforces each source's own
   declared `requestsPerMinute` before every call
   (`SOURCE_ADAPTERS.md`) — this protects the *external* service from
   VentureForge, not just the reverse. Internally, the Research
   Agent's own bounded pipeline (≤3 tool calls per execution,
   round-robined across sources — `research-agent.service.ts`) and the
   cycle-level `maxToolCalls` ceiling (`RESEARCH_SCHEDULING.md`) both
   independently cap how many calls one research effort can make
   regardless of the rate limiter.
9. **Resource exhaustion.** Two full budget layers
   (`RESEARCH_SCHEDULING.md`): the unchanged per-`AgentExecution`
   budget, and the new per-`ResearchCycle` budget bounding the *sum*
   across every execution a cycle spawns, checked before every stage.
   A bounded comparison window (200 recent signals, never a full-table
   scan) keeps deduplication/clustering cost bounded regardless of how
   large the `signals` table grows over time (`SIGNAL_MODEL.md`,
   M3 brief Part 45's N×M×K warning).
10. **Duplicate signal flooding.** The three-level deduplication
    pipeline (`SIGNAL_MODEL.md`) exists specifically to prevent this —
    a flood of near-identical reposts collapses to one `PROCESSED`
    signal plus many explicitly-linked `DUPLICATE` rows, none of which
    count toward a cluster's `signalCount`/`independentSourceCount` or
    ever reach a model call. Proven directly:
    `tests/integration/signal.test.ts`'s "never inflates a duplicate's
    quality score" test and `signal-clustering.test.ts`'s duplicate
    rejection test.
11. **Source spoofing.** A signal's `source` field is always the
    literal `id` of the `ResearchSource` that actually produced it
    (set by `research-agent.service.ts`, never caller-suppliable
    through any API — there is no endpoint that lets a caller assert
    an arbitrary `source` value for a signal). Reliability is seeded
    from the real, code-defined `SOURCE_RELIABILITY` policy table
    keyed by that same id (`domain/evidence/source-reliability-policy.ts`)
    and fails closed to `LOW` for any id not in the table — a
    hypothetical spoofed or newly-added source id can never claim more
    trust than the most conservative default.
12. **Model manipulation.** Every structured output is Zod-validated
    with one bounded corrective retry, then a hard failure
    (`completeWithValidation`, unchanged from M2) — a model cannot
    return an out-of-schema value, an out-of-range score, or an
    invalid enum and have it silently accepted anywhere in M3.
    `assertUnitInterval`-style checks (`opportunity-scorer.ts`,
    `kill-risk-scorer.ts`) independently re-validate every numeric
    dimension at the service layer too, not just at the schema
    boundary — defense in depth against a model finding a way past the
    first check.

### Least privilege, reaffirmed for the four new agents

Problem Analyst, Market Analyst, and Opportunity Analyst hold **zero**
permission grants in every test and the demo — they make no tool
calls, so `READ_WEB` was never granted to them, and nothing in their
code path calls `handle.callTool()`, so there is nothing to
authorize. Only Competitor Analyst is granted `READ_WEB`, matching
exactly what it needs and nothing more.

### Dependency posture (M3)

`npm audit --omit=dev` still reports **zero** vulnerabilities in
production dependencies after adding M3's code — no new production
dependency was introduced (`HackerNewsSource`/`StackExchangeSource`
both use the global `fetch`, matching M2's own no-SDK precedent).

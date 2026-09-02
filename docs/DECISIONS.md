# Architectural Decisions

> **M2 note:** decisions #1–13 below are M1's, unchanged and kept in
> full as a historical record. M2's decisions are appended starting at
> #14. Where an M2 decision supersedes or changes the mechanism behind
> an M1 decision, the M1 entry is left as-is (it was correct for M1's
> scope) and the M2 entry says explicitly what changed and why.

## 1. Stack: TypeScript + Node + Express + Prisma/SQLite + Zod + Vitest

The repository was completely empty before M1 (only `CONSTITUTION.md`
and `README.md` existed) — no existing stack or convention to
preserve or conflict with, so this was a green-field choice against
the M1 brief's own criteria: modular, auditable, permission-aware,
typed, testable, provider-agnostic, "minimal, maintainable... prefer
simple/explicit over massive/over-engineered."

- **TypeScript** — the M1 brief explicitly asks for "typed"; a
  governance-and-audit kernel benefits more than most systems from the
  compiler catching a wrong status string or a mismatched entity id at
  build time. `strict: true` and `noUncheckedIndexedAccess: true` are
  both on.
- **Express 4** over Fastify/Koa/a full framework — the most widely
  understood minimal HTTP layer; M1's API surface is small enough that
  a heavier framework's extra structure (schema-first routing,
  plugins) wouldn't pay for itself yet.
- **Prisma + SQLite**, not Postgres — no infrastructure to stand up,
  migrations are real and checked in, and tests run against a real
  SQL engine (foreign keys, constraints) rather than mocks. Prisma's
  schema is close enough to Postgres that moving later is a datasource
  change, not a rewrite. The concrete gaps this creates (no native
  enum type, no role-based privilege separation) are called out below
  and in `SECURITY.md`, not hidden.
- **Zod** for request validation — pairs naturally with TypeScript
  inference, keeps validation declarative and colocated with each route.
- **Vitest + Supertest** — fast, native ESM/TS support, no separate
  transpile step; Supertest drives the real Express app in integration
  tests without binding a port.

## 2. SQLite now, Postgres later — and what that costs

**Decision:** ship M1 on SQLite; design the schema so a move to
Postgres is a `datasource` change plus re-running the CHECK-constraint
step as native enums, not a data-model rewrite.

**Cost accepted today:**
- No native enum type on this connector (see #3).
- No database-level privilege separation, so "audit log is append-only"
  is an application-layer guarantee, not a database one (`SECURITY.md`).
- Single-writer characteristics — fine for one founder driving the
  kernel directly; not something to scale multi-agent concurrent load
  on without moving to Postgres first.

## 3. Enums as validated `String` + SQLite `CHECK` constraints

`prisma validate` rejects a native `enum` outright on the SQLite
connector ("the current connector does not support enums" — verified
directly, not assumed). Every enum-like field is therefore a `String`
column, with the canonical value set defined once in TypeScript
(`src/domain/**`) as a `readonly [...] as const` array + derived union
type, checked at every write path.

To avoid *only* trusting application code, the initial migration was
hand-augmented with SQLite `CHECK` constraints on every enum-like and
bounded-numeric column (see `SECURITY.md`) — a value that somehow
skipped the TypeScript/Zod guards still can't land in the database.
This is the direct, load-bearing implementation of the M1 brief's
"fail closed for unknown permissions" / "fail closed for unknown risk
levels."

## 4. Permission → risk-level mapping (`src/domain/risk/permission-risk-policy.ts`)

The Constitution's autonomy-level examples (§8) are broad activities
("external outreach," "major deployment"), not the 11 `Permission`
values the M1 brief names (§7) — there is no 1:1 mapping given, so
this table is a founding **policy decision**, isolated in one file so
it's easy to find and revise:

| Permission | Level | Why |
|---|---|---|
| `READ_WEB`, `READ_DATABASE`, `WRITE_DATABASE` | GREEN | Matches §8 GREEN's research/evidence-collection/opportunity-discovery examples directly. |
| `EXECUTE_CODE`, `WRITE_FILES` | YELLOW | Not named directly in §8; a broad capability grant with real blast radius, so kept conservative rather than assumed GREEN. |
| `SEND_EXTERNAL_MESSAGE`, `CREATE_EXTERNAL_ACCOUNT`, `DEPLOY_APPLICATION` | YELLOW | Directly matches §8 YELLOW's "external outreach," "external account creation," "major deployment." |
| `ACCESS_SECRET`, `MODIFY_CONFIGURATION` | ORANGE | Matches §8 ORANGE's "significant infrastructure changes"; sensitive enough to warrant more than ordinary approval. |
| `SPEND_MONEY` | RED | Matches §8 RED's "major financial transfers"; kept uniformly RED rather than tiered by amount (Constitution §21, Capital Discipline: never spend merely because access exists). Amount-based tiering is a reasonable M2 refinement, not assumed here. |

**This table is listed under "Decisions requiring founder approval"**
in the M1 report — it is a real policy choice, not derived logic.

## 5. `ApprovalRequest.resourceType` / `resourceId` — a deliberate field addition

The M1 brief's literal `ApprovalRequest` field list (§8) has no way to
say what an approval is *about*. Without it, the Human Decision Queue
cannot show "why now?" in context and the vertical slice (§17) cannot
link a decision back to the opportunity that produced it — both
explicit M1 requirements. Added rather than deferred, because the
slice cannot exist without it; documented here per the brief's own
rule ("if you discover something useful, stop, document it" — this
was necessary for M1 itself, not deferred to M2).

## 6. `OpportunityScoreRecord` — score history, not just a current value

Also not in the brief's literal field list. `opportunity_score` /
`confidence_score` on `Opportunity` hold the *current* score; every
`scoreOpportunity` call additionally appends a history row. Without
this, re-scoring an opportunity destroys the trail behind whatever
decision was made against the previous score — directly against the
evidence-first principle's "why do we believe this?" (Constitution §11).

## 7. Task `QUEUED → CANCELLED`

The M1 brief's example transitions are `PENDING→QUEUED→RUNNING→COMPLETED`,
`RUNNING→FAILED`, `RUNNING→CANCELLED`, `PENDING→CANCELLED`. Taken
literally, a queued-but-not-yet-running task could never be cancelled
— `CANCELLED` would be unreachable from `QUEUED`. Read as an omission
rather than a deliberate restriction and added; every other transition
matches the brief exactly.

## 8. Evidence verification: a permissive transition table, not a strict lifecycle

The Constitution defines what `UNVERIFIED/PARTIALLY_VERIFIED/VERIFIED/
DISPUTED/REJECTED` *mean* (§14, §31) but not a required order between
them. M1 allows any forward or lateral move except out of `REJECTED`
(terminal) — including `VERIFIED → DISPUTED`, since new contradicting
evidence can surface after something was verified. This uses the same
generic state-machine utility as every other lifecycle field, so it
cost nothing extra to make explicit rather than leaving verification
status as an unguarded free string.

## 9. Validation level: a foundation guard, not the full policy

Constitution §14: "agents must not claim Level 6 based only on Level 1
evidence." Implementing the *full* policy — which evidence mix
actually justifies which level — is explicitly out of M1 scope ("we
are establishing the foundation"). M1 implements the one guard cheap
and unambiguous enough to belong in the foundation itself: a
validation level above `LEVEL_0` requires **at least one** attached
Evidence record. Deciding *how much and what kind* of evidence
justifies *which* level is left to M2, flagged in the final report's
"Recommended M2" section.

## 10. ORANGE/RED route to the Human Owner, not a Chairman agent

No Chairman agent exists in M1 (explicitly out of scope). `RiskPolicy.requiresChairman`
is recorded as metadata on ORANGE decisions for a future Chairman
workflow to consume, but every YELLOW/ORANGE/RED decision today is
reviewed by the same Human Decision Queue. This is not a governance
gap in principle — the Constitution's Human Owner already holds
ultimate authority (§2) and Chairman review is presented as
*additional* governance on top of that, not a substitute for it — but
it does mean M1 cannot yet distinguish "the Human Owner personally
reviewed this" from "the Chairman would also have reviewed this."
Flagged as a founder-relevant gap in the final report.

## 11. No authentication (see `SECURITY.md` for the full threat model)

Documented explicitly per the M1 brief's own instruction, rather than
building a fake login system that would imply a security boundary
that doesn't exist.

## 12. `HUMAN_OWNER_IDS` is a configured allow-list, not a hardcoded person

Human Owner identity is a deploy-time environment variable
(`.env` → `config.humanOwnerIds`), never a name or email baked into
source. `config.assertConfigValid()` refuses to start the process if
it's empty. This keeps the kernel itself free of any specific
operator's identity and makes the allow-list something the founder
controls per deployment.

## 13. `ModelProvider` port defined, deliberately unused

`src/domain/ports/model-provider.ts` exists because the M1 brief names
"provider/model agnostic" as a required architecture property and asks
for interfaces "where appropriate." Nothing in M1 calls a real
implementation of it, because M1 has no autonomous agent-execution
loop for it to serve — building one would be the "complex multi-agent
LLM orchestration framework without need" the brief explicitly
forbids. The interface is the seam; M2's agent runtime is what plugs
into it.

---

## M2 decisions

## 14. Two actor shapes, bridged explicitly, not unified

M1's services already take an `Actor` (`{actorType, actorId}`,
`agent.service.ts`) as `createdBy`/`grantedBy`/`reviewedBy`/`actor`
params throughout `agentService`/`taskService`/`evidenceService`/
`opportunityService`/`approvalService`. M2 adds authentication, which
produces a different, stricter shape: `AuthenticatedActor`
(`{type, id, identityId}`, `domain/identity/identity.types.ts`) — the
*verified* result of resolving a bearer token, never something a
caller can construct directly.

**Considered:** collapsing these into one type. **Rejected:** `Actor`
is a plain data shape used pervasively by M1 services (including in
tests that construct one by hand for a non-HTTP scenario) and
changing its field names would touch every M1 service signature for
no behavioral gain. `AuthenticatedActor` additionally carries
`identityId` (the credential's own id, distinct from the resolved
agent/human id) which `Actor` has no use for. Kept as two types with
one explicit bridge function, `toActor(authenticated): Actor`
(`api/middleware/authenticate.ts`), used at every route boundary where
an M1 service is called with a freshly-authenticated caller. The cost
is a real one — mixing the two up was the single most common bug
during M2 implementation (getting a plain object literal where a
service expected the other shape) — accepted because the alternative
(one sprawling type serving both an internal plain-data role and an
externally-meaningful "this was cryptographically verified" role)
seemed worse for a reader trying to know, at a glance, whether a given
`actor` value in scope has actually been authenticated or was merely
constructed.

## 15. `HUMAN_OWNER_IDS` removed entirely, not kept as a fallback

M1's `config.humanOwnerIds` allow-list (#12 above) is gone from
`config.ts` — not deprecated-but-supported, not toggleable. The M2
brief's authentication requirement ("do not rely on arbitrary
caller-supplied identifiers for privileged operations") is
incompatible with keeping a code path where a request body's own
string is trusted as an identity, so keeping both would mean the
insecure path was still reachable. `assertConfigValid()` now instead
validates `MODEL_PROVIDER_MODE`/`RESEARCH_TOOL_MODE`/`anthropicApiKey`
consistency — same fail-closed-at-startup principle (#12), different
subject.

## 16. Opaque, hashed bearer tokens — not JWTs, not sessions

`vf_<32 random bytes, base64url>`, SHA-256-hashed at rest
(`domain/shared/tokens.ts`), looked up by hash on every request. JWTs
were the obvious alternative and were rejected: a JWT's whole value
proposition (verify without a database round-trip, via a signature) is
not a real win here — every authenticated call already hits the
database for authorization/business logic, so "stateless" verification
buys nothing, while it costs a signing-key lifecycle (generation,
rotation, what happens on suspected compromise) and, without an extra
revocation list, no way to immediately invalidate a single compromised
token short of rotating the whole signing key. An opaque DB-backed
token makes revocation exactly one `UPDATE identities SET status =
'REVOKED'` with no blacklist to maintain — simpler and strictly more
controllable for a single-deployment kernel. Sessions/cookies were not
considered seriously: this is an API, not a browser app.

## 17. Development-mode fixtures must be honest, and that honesty must be provable, not asserted

Both new "no live credentials in this sandbox" seams —
`DevelopmentModelProvider` and `DevelopmentSearchTool` — could have
returned plausible-looking canned output to make demos look nicer.
Rejected outright per the M2 brief's explicit instruction ("never
fake successful production execution," Part 28): both either echo a
caller-supplied, explicitly-labeled fixture or throw; neither ever
invents content and claims it came from a model or a real search.

The harder design question was proving this in a way stronger than
"the code comment says so." Decision: every dev-mode fixture that
matters for a governance decision (the Chairman's, specifically —
`buildDevChairmanFixture`, `CHAIRMAN.md`) must be a genuine function of
real input data, not a static string — so that "different real inputs
produce different real outputs" is a property `chairman.test.ts` can
assert directly (`strongReview.decision.decision !==
weakReview.decision.decision`), rather than something only reviewable
by reading source. The same standard was applied to
`DevelopmentSearchTool` (output derived from the actual query text)
even though nothing downstream currently asserts on that specific
property — kept consistent rather than cutting the corner where no
test would catch it.

## 18. Fixed, bounded pipeline over a dynamic planning loop

The Research Agent's steps (PLAN → TOOL(×≤3) → SYNTHESIZE →
PROCESS_RESULT) are hardcoded in `research-agent.service.ts`, not
decided at runtime by a model choosing how many tool calls it wants.
**Considered:** a generic "agent decides its own next action" loop
(the more conventional agentic-AI pattern). **Rejected:** the M2 brief
explicitly warns against unrestricted loops (Part 21), and a dynamic
planner still needs *some* hard ceiling enforced by code, at which
point the interesting engineering problem is the ceiling, not the
planner — building the ceiling first, alone, is both sufficient for
M2's one agent and the safer foundation to layer a real planner on
top of later, because the safety mechanism (`ExecutionBudget`,
`AGENT_RUNTIME.md`) doesn't depend on trusting the planner to respect
it; it's enforced from outside regardless of what the pipeline inside
does. A dynamic planner remains explicitly deferred
(`M2_ARCHITECTURE_PROPOSAL.md` §19).

The specific default budget numbers
(`maxSteps: 6, maxToolCalls: 3, maxModelCalls: 3, maxRetries: 2,
maxDurationMs: 30_000`) were sized to the one pipeline that exists
today (which needs at most 2 model calls + 3 tool calls) with a small
margin, not derived from a cost or latency SLA — a founder-relevant
number to revisit once a second, larger agent exists. Flagged in the
M2 final report's decisions-requiring-founder-approval section.

## 19. A tool call requiring approval fails the execution rather than suspending it

`ExecutionHandle.callTool` treats `authorize()` returning
`REQUIRES_APPROVAL` the same as `DENIED` — it fails the call (and, by
propagation, normally the whole execution) rather than pausing
mid-run for a human to decide. **Considered:** suspending the
execution (persist its state, surface it on the Human Decision Queue,
resume on approval). **Rejected for M2, not rejected outright:**
this needs its own state (what does a suspended `AgentExecution` look
like on disk, how does resume reconstruct in-memory pipeline state,
what happens if the underlying grant is denied instead of approved
weeks later) that is a real subsystem in its own right, not a small
addition to the current runtime — building it well was judged out of
scope for a milestone whose one real tool is GREEN-risk anyway (so the
branch is defensive/forward-looking, not load-bearing for anything M2
actually ships). Failing closed was chosen over the other cheap
options (silently proceeding — a clear governance violation; hanging
indefinitely — worse than failing, since it would look like the
system was still working) as the only safe default until suspension
is built. Explicitly listed in `M2_ARCHITECTURE_PROPOSAL.md` §19 and
the M2 final report's deferred-features list.

## 20. Validation-level policy: specific per-level numbers are a founding policy choice, isolated

M1 (#9) deferred "which evidence mix justifies which level" entirely.
M2's answer (`VALIDATION_LEVEL_REQUIREMENTS`,
`domain/opportunity/validation-policy.ts`, documented fully in
`VALIDATION_POLICY.md`) is a concrete table — minimum evidence count,
minimum average confidence, and from `LEVEL_3` up a required evidence
*type* at a required reliability. Like the permission→risk table (#4),
this is presented as a policy decision a founder can revise, not
derived logic — isolated in one file specifically so revising "how
much evidence is enough" never requires touching the enforcement code
in `opportunityService.setValidationLevel`. The two structural
gates — `requiresHumanActor` from `LEVEL_4`, `requiresChairmanApproval`
from `LEVEL_5` — read the Constitution's "agents must not claim Level
6 based only on Level 1 evidence" (§14) as "meaningfully validating an
opportunity is a human call once the evidence bar gets non-trivial,"
not merely an evidence-quantity statement.

One direct consequence: `opportunities.test.ts`'s pre-existing M1
assertion that 1 evidence item satisfies `LEVEL_2` no longer holds
under the stricter table (`LEVEL_2` now needs 2 records at
avg-confidence ≥ 0.3). The test's target level was changed to `LEVEL_1`
(still satisfied by 1 record) with a comment pointing at the fuller
policy's own dedicated test file — recorded here as a deliberate,
expected consequence of formalizing the policy per the brief's own
instructions, not a silently-patched regression.

## 21. Four new tables, and three tables deliberately not created

`identities`, `agent_executions`, `tool_executions`, `chairman_reviews`
— each justified individually in `M2_ARCHITECTURE_PROPOSAL.md` §12;
summarized here for the record alongside what was *not* added and why:

- **No `tool_definitions` table.** A tool's `execute()` is behavior;
  storing it as a row means either storing code-as-data or maintaining
  a parallel code registry anyway. `ToolRegistry` is in-process code
  (`TOOL_SYSTEM.md`); `tool_executions` is the genuinely-data part (a
  call's input/output/timing).
- **No `execution_budgets` table.** Budgets are per-agent-type code
  configuration (`DEFAULT_EXECUTION_BUDGET`), not runtime state that
  changes without a code change — a database row would imply an admin
  UI for tuning budgets live, which doesn't exist and wasn't asked
  for. Usage *counters* (how much of the budget this execution
  consumed) do live in the database, as columns on `agent_executions`
  — the distinction is budget-as-limit (code) vs. budget-as-consumption
  (data).
- **No `model_runs` table.** M2 has exactly two model-calling call
  sites per research execution (plan, synthesize) plus one for a
  Chairman review — aggregate counters (`modelCallCount`,
  `retryCount`) on `agent_executions` capture what's needed at this
  granularity. Flagged as a reasonable addition once a future agent
  makes enough per-call-distinct model calls that per-call (not just
  per-execution) telemetry earns its complexity.

## 22. One error-code taxonomy, shared by HTTP responses and stored execution state

`domain/shared/error-codes.ts`'s `ERROR_CODES` (`VALIDATION_ERROR`,
`AUTHENTICATION_ERROR`, `AUTHORIZATION_ERROR`, `TOOL_ERROR`,
`MODEL_ERROR`, `TIMEOUT`, `RATE_LIMIT`, `BUDGET_EXCEEDED`,
`DOMAIN_ERROR`, `INTERNAL_ERROR`) is the one vocabulary every
`DomainError` subclass carries (`errorCode`, alongside its HTTP
`statusCode`) and the same vocabulary `AgentExecution.errorCode`
stores. **Considered:** letting HTTP error codes and stored-execution
error codes drift as two separate enums (HTTP concerns and persistence
concerns are, in general, different axes). **Rejected:** a caller
reading `GET /api/agent-executions/:id` after a failure and a caller
reading the HTTP error from the `POST` that started it should see the
*same* code for the *same* underlying failure — two vocabularies would
mean a translation table between them for no benefit, since every
`DomainError` already flows through both paths (thrown during a
request, or caught inside `agentRuntimeService.run` and persisted).

## 23. Chairman review is a separate, explicit stage — not folded into the research pipeline

`chairmanService.review()` is its own service, its own endpoint
(`POST /api/opportunities/:id/chairman-review`), called *after*
`researchAgentService.run()` completes, not a final step inside it.
**Considered:** having the research pipeline automatically trigger a
Chairman review on completion, closer to a single "do everything"
call. **Rejected:** the Constitution's own pipeline (§28) is
PROPOSAL → CEO → CHAIRMAN REVIEW → GUARDIAN REVIEW → HUMAN APPROVAL as
four distinct stages with their own actors and records; collapsing
Chairman review into the research agent's own execution would make it
look like part of the *same* actor's reasoning rather than an
independent challenge to it, undermining the "not a rubber stamp"
property this milestone was specifically asked to prove
(`CHAIRMAN.md`). Keeping it a separate call also means an opportunity
can be re-reviewed later (new evidence arrives, someone wants a fresh
Chairman opinion) without re-running research from scratch —
`chairmanService.listReviews` returns every review, not just the
latest, for exactly this reason.

## 24. Cost/token tracking columns exist but are not yet populated — recorded as a known gap, not hidden

`AgentExecution.promptTokens`/`completionTokens`/`estimatedCostUsd`
were added to the schema (with a `estimatedCostUsd >= 0` CHECK
constraint) because the M2 brief's observability requirements (Part
22) name cost tracking explicitly, and adding the columns later would
be a migration; but `AnthropicModelProvider.complete()` does not
currently parse Anthropic's response `usage` block to populate them,
since the provider is not live-exercised in this environment and no
automated code path spends real money regardless. Recorded here,
`AGENT_RUNTIME.md`, and `SECURITY.md`'s "Runaway cost" item as the
same single gap from three different angles (schema, runtime, threat
model) rather than three different problems — deliberately flagged as
a required addition before a real deployment attaches a live,
billable model key, per the M2 brief's own "flag rather than silently
build/skip" instruction.

## 25. Agent-impersonation guard added ad hoc, at the specific routes that needed it — not as new middleware

The `actor.type === "AGENT" && body.<field> !== actor.id` check
(`SECURITY.md`) is repeated inline in three route files rather than
factored into a new piece of middleware. **Considered:** a generic
`requireSelfAttribution(fieldName)` middleware applied declaratively.
**Rejected for now:** only three routes need it, the field name they
check differs (`collectedByAgentId`, `requestedByAgentId`,
`agentId`), and a three-line inline `if` at each call site is more
immediately readable than an abstraction covering three call sites —
consistent with the standing instruction not to introduce an
abstraction before it's earned its keep. Worth revisiting if a fourth
or fifth route needs the same shape of check.

---

## M3 decisions

## 26. Signal, Evidence, Problem, Opportunity stay four separate entities — and Evidence sits downstream of Problem, not upstream

The M3 brief's Part 1 pipeline diagram and Part 3's simplified
five-node illustration order Evidence and Problem differently (Part 1:
Problem Candidate → Multi-Source Evidence → Opportunity; Part 3:
Signal → Evidence → Problem → Opportunity → Decision). Read Part 1 as
authoritative — it's the detailed, literal pipeline; Part 3 is making
a qualitative point ("these are different concepts," not a second,
conflicting literal ordering). Concretely: a `Signal` is cheap and raw;
it becomes `Evidence` only once it's actually used to back a specific
Problem's claim, at the point that Problem is being promoted toward an
Opportunity (`opportunity-analyst.service.ts`'s `promoteSignalsToEvidence`,
`OPPORTUNITY_INTELLIGENCE.md` §8) — never automatically, matching Part
3's real requirement ("a single signal should not automatically become
an opportunity") without needing Part 1 and Part 3 to describe a
literal identical sequence.

## 27. `ResearchSource` split from `Tool` — a new, narrower interface, not a `Tool` subtype

**Considered:** giving each source its own `Tool` implementation
directly (what M2's `HackerNewsSearchTool` already did). **Rejected:**
would duplicate permission/risk/budget-related boilerplate per source
the way M2's one-tool design already showed the cost of once a second
source was needed. `ResearchSource` (`src/sources/research-source.ts`)
knows only how to search one system; `SourceSearchTool`
(`src/tools/source-search.tool.ts`) is the one generic bridge to
`Tool` — adding a new source is implementing one interface and one
registration line, touching neither the runtime nor any existing tool.
See `SOURCE_ADAPTERS.md`.

## 28. Two real sources; Reddit deliberately not built even as unauthenticated

Hacker News (carried over from M2) and Stack Exchange — both public,
keyless, explicitly built for programmatic search, satisfying "quality
over quantity" (M3 brief Part 6/45) without padding. Reddit was
seriously considered and rejected specifically because its only
keyless path (the legacy `.json` endpoints) is not a legitimate
substitute for automated use at real volume under Reddit's current API
terms — building it would mean shipping code that's unsafe to actually
run, which is worse than not building it. See `SOURCE_ADAPTERS.md` for
the full reasoning and what a founder would need to do to add it for
real (register an OAuth app).

## 29. Deterministic token-overlap similarity, not embeddings, for both dedup and clustering

**Considered:** an embedding-based nearest-neighbor approach for both
near-duplicate detection and clustering. **Rejected for M3:** the M3
brief explicitly defers "complex vector memory" (Part 33); a plain
Jaccard token-overlap score (`domain/signal/similarity.ts`) is cheap,
requires no new dependency or model call, and — critically — is fully
explainable: a similarity *number between two specific texts* is
directly inspectable in a `duplicateReason` string, where a
nearest-neighbor result in embedding space is not without additional
tooling this milestone doesn't need yet. Cost accepted: no stemming,
so near-synonymous phrasing ("invoice" vs "invoices") isn't credited —
a known, documented limitation (`SIGNAL_MODEL.md`), not a hidden one;
it also shaped how test fixtures had to be constructed (`tests/integration/problem-analyst.test.ts`'s
`raw()` comment explains the fixed-core-plus-unique-filler-tokens
pattern this required).

## 30. Independence tracking (`sourceGroupKey`) is real and tested, but unexercised by either live source today — said plainly, not hidden

Both registered sources search for standalone stories/questions, so
neither adapter currently has a genuine "these results share a thread"
concept to report — `sourceGroupKey` is `null` from both today, and
`independentSourceCount` is effectively `signalCount` in current
practice (every null-grouped signal counts as its own independent
source). The mechanism itself is real, not decorative: it's exercised
directly with synthetic grouped data in `tests/unit/cluster-confidence.test.ts`,
and it's exactly what a future comment-level source (e.g. multiple
replies in one Reddit thread) would populate without any schema
change. Recorded here rather than only in a code comment, matching the
same honesty standard as M2's `AWAITING_HUMAN`-has-one-producer note.

## 31. All four new agents run through `agentRuntimeService` — including the three that make zero tool calls

**Considered:** giving Problem Analyst, Market Analyst, and
Opportunity Analyst a lightweight, Chairman-style treatment (a plain
service function calling `ModelProvider.complete()` directly, no
`AgentExecution` row) since none of them use `handle.callTool()`.
**Rejected:** the M3 brief's Part 24 explicitly asks every new agent
to have real "permissions, tools, risk level, budget, termination
conditions" — a bespoke lightweight service doesn't naturally carry
budget/termination semantics the way `agentRuntimeService` already
does for free, and every one of these four is meant to be a real,
independently-accountable `Agent` registry entry (unlike Chairman,
which the Constitution's own hierarchy treats as a distinct
governance role sitting above the CEO's department agents, not one of
them — `CHAIRMAN.md`). `agentRuntimeService.run()` fully supports
"zero tool calls, one or two model calls" as a legitimate pipeline
shape; using it uniformly costs nothing and buys consistent
`AgentExecution` telemetry (execution id, timing, retryCount,
errorCode) for every agent, not just the ones that happen to touch a
tool.

## 32. Kill-risk fields extend `OpportunityScoreRecord`; no new table

Same reasoning as M1's `OpportunityScoreRecord` itself
(`DECISIONS.md` #6): kill-risk is produced by the same synthesis step
that produces the attractiveness score and needs the same
point-in-time history — splitting them into two separately-timestamped
tables would let them drift out of sync (a kill-risk re-assessment
without a matching score re-assessment, or vice versa) for no benefit.
Score, confidence, and kill risk remain three independently-read,
never-conflated numbers at the read layer even though two of the three
live in one table.

## 33. Evidence-gap impact ranking: uniform dimension weight, extremity-adjusted

**Considered:** weighting each of the 14 scoring dimensions
differently by "how much it usually matters." **Rejected for M3:**
no real usage data exists yet to justify differential weights, and a
plausible-sounding but uncalibrated weighting scheme would be worse
than an honestly-uniform one (1/14 each). The one refinement kept —
ranking an assumed dimension higher when its assigned value sits near
an extreme (0 or 1) rather than a neutral 0.5 — is justified
independently of any calibration: an unverified extreme assumption has
more room to be wrong in a way that changes the outcome. See
`OPPORTUNITY_INTELLIGENCE.md`.

## 34. Research queue priority can go negative — never floored to 0

`domain/research-queue/priority.ts`'s formula subtracts both a
kill-risk term and a cost term from a positive information-gain/score
term. A sufficiently costly, high-risk, low-scoring item legitimately
scores below zero. **Considered:** clamping to `[0, 1]` like every
other score in this codebase. **Rejected:** clamping would make every
genuinely-not-worth-doing item indistinguishable from a merely
marginal one at the floor, destroying exactly the ranking information
the queue exists to provide. `research_queue_items.priority_score` has
no CHECK-constraint bound in the migration for the same reason
(`evidence_gaps.impact_score`, by contrast, *is* bounded 0..1, since
that formula is designed to stay in range by construction — a
deliberate, considered difference between the two, not an oversight).

## 35. `ResearchCycle` carries both "research cycle" and "operating window" as one lifecycle

**Considered:** a separate `OperatingWindow` entity wrapping one-or-more
`ResearchCycle` rows, matching the M3 brief's Part 28/29 naming two
concepts. **Rejected:** in this implementation a cycle *is* the
bounded unit of work an operating window would represent — there is no
scenario in M3 where a window contains more than one cycle or a cycle
outlives its window. Two entities would mean keeping two lifecycles in
sync for a distinction that doesn't exist yet. If a future milestone
genuinely needs a window spanning multiple cycles (e.g. a whole
weekend's worth), splitting them apart then is a schema addition, not
a rewrite — `ResearchCycle` doesn't assume it's the only cycle that
will ever run.

## 36. No `opportunity_problems` or `problem_signals` join tables

Both relationships are modeled as direct foreign keys instead
(`Opportunity.problemId`, `Problem.clusterId`) — see
`docs/M3_ARCHITECTURE_PROPOSAL.md` §16 for the full reasoning. The
degree of freedom this design actually needs (one Problem can spawn
more than one Opportunity framing over time) is exactly what a
one-directional FK already supports; a join table would additionally
allow the reverse (one Opportunity spanning multiple Problems), which
nothing in the brief asks for and which would complicate the
traceability walk (`OPPORTUNITY_INTELLIGENCE.md` §"Traceability") for
a capability not needed.

## 37. Real bugs this build caught before they shipped — recorded, not smoothed over

Consistent with this codebase's own transparency principle
(Constitution §29), three genuine defects were found and fixed during
M3 development via smoke-testing and the automated suite, not
theorized away:

- The `events` table's SQLite `CHECK` constraint on `type` still
  listed only M1's literal event names — adding six new
  `DOMAIN_EVENT_TYPES` entries in code without a matching migration
  meant `RESEARCH_CYCLE_STARTED` failed at the database layer the
  first time a research cycle actually ran. Fixed with an additive
  migration (`20260901120000_m3_event_types`) rebuilding the table
  with the full constraint list. This is exactly what the "fail-closed
  enums, in the database too" pattern (`SECURITY.md`) is *for* — it
  caught a real application-code drift, not a hypothetical one.
- `ResearchCycle.objective` was written once at creation from the
  caller's request and never updated when the cycle actually resolved
  a different objective from the research queue (`RESEARCH_SCHEDULING.md`)
  — the persisted record would have silently misrepresented what a
  cycle actually researched. Fixed by resolving the objective before
  the `RUNNING` transition and persisting the resolved value.
- `Evidence.signalId` — the column the idempotent
  signal-to-evidence-promotion check depends on — was being written
  into `metadata` instead of the real column, silently defeating its
  own purpose (every re-generation would have created duplicate
  Evidence rows instead of reusing them). Fixed by threading `signalId`
  through `CollectEvidenceParams`/`CreateEvidenceInput` as a first-class
  parameter.

All three were caught before being reported as working — by a
throwaway smoke-test script exercising the real orchestrator end to
end (the first two) and by the automated integration suite (the
third) — not discovered later. Recorded here per the standing
instruction to document what was found, not only what shipped clean.

## 38. `researchQueueService.populateForOpportunity` needed an idempotency guard M3 never required

M3 only ever called `populateForOpportunity` once per opportunity
(right after `opportunityAnalystService.run()` created it), so its
unconditional `researchQueueRepository.create()` per unresolved gap
never had a chance to duplicate anything. M4's `evidenceGapService.analyzeClaim`
updates a claim-linked gap **in place** across many decision cycles
(§15) — calling the unmodified `populateForOpportunity` again after
that would have created a second `ResearchQueueItem` pointing at the
same, now-updated gap every single cycle. Fixed by adding
`researchQueueRepository.findActiveByEvidenceGapId` and refreshing an
existing PENDING/IN_PROGRESS item's priority in place instead of
creating a duplicate — caught by a smoke test running a second
decision cycle on the same opportunity and asserting the queue-item
count didn't double (`docs/M4_ARCHITECTURE_PROPOSAL.md` §16 records
this as a "real latent gap in the M3 function," not a new one M4
introduced).

## 39. Claim-level evidence gaps are never auto-resolved

Considered auto-resolving a claim's `EvidenceGap` once its status
reaches `SUPPORTED`/`CONTRADICTED`. Rejected: a Claim's validation
status is a complete digraph with no terminal state (§5) — new
evidence can move a `SUPPORTED` claim back to `WEAK` next cycle without
the claim itself ever "closing." Auto-resolving the gap on first
`SUPPORTED` would stop tracking a claim the moment it looked good once,
exactly the kind of premature closure the Expected Information Gain
formula's own non-zero `uncertaintyFactor` for `SUPPORTED`/`CONTRADICTED`
(0.3, not 0 — domain/claim/eig.ts) already argues against. Resolution
stays an explicit human/CEO call; the formula's own low-but-nonzero
score is what keeps a well-supported claim's gap sorted near the
bottom of the queue instead of hidden entirely.

## 40. `ValidationReport.confidence` and `Claim.confidence` are deliberately two different numbers

The former is the Evidence Validator's own direct self-assessment
(part of its Zod-validated structured output, analogous to
`ChairmanReview.confidence`); the latter is the separate, deterministic
value `claim-confidence.service.ts` computes from the report's
*factors* (reliability/specificity/recency/independence/corroboration-count/
contradiction-count — §11), not from the report's own confidence field
directly. Considered collapsing them into one column. Rejected: the
whole point of §11's formula is that Claim confidence must stay
reproducible from stored factors, auditable independent of whatever
number a model happened to self-report — conflating the two would mean
a future prompt change to the Validator could silently change claim
confidence with no corresponding formula change to explain why.

## 41. WTP payment-intent detection matches evidence text, not the claim's own statement — and strips the claim-type phrase first

The Chairman's dev-fixture worked example (§19: flag a SUPPORTED
willingness-to-pay claim whose only support lacks real payment-intent
language) initially checked `Claim.statement` itself, which is often a
negative assertion ("No explicit willingness-to-pay signal found") —
"pay" appearing inside the words "willingness-to-pay" made the naive
check false-negative on the exact case it was meant to catch. A second
bug in the same feature: the Evidence Validator's own counter-evidence
search uses a claim's statement as its query, and the development
source's fixture results echo that query back ("Discussion mentioning
'<query>' ..."), reintroducing the same "willingness-to-pay" substring
into a piece of *evidence* text even after the check was moved to look
at evidence instead of the claim. Fixed by (1) checking the claim's
actual `SUPPORTING`-classified evidence text via the latest
`ValidationReport`, not the claim's own restated summary, and (2)
stripping the `willingness[-\s]?to[-\s]?pay` phrase from evidence text
before testing for real payment-intent words. Both caught by a smoke
test seeding a real "I wish this existed" (no purchase intent) evidence
item and asserting the objection actually fires.

## 42. No event-bus subscriber for `OPPORTUNITY_DECISION_RECORDED`

M3's original doc comment for this reserved-but-unfired event type
described a future "opportunity-feedback event-bus subscriber." A
repo-wide grep confirmed `eventBus.subscribe()` had zero callers
anywhere in M1-M3. M4 fires the event directly from the one call site
that needs it (`decisionRecordService.applyHumanDecision`) rather than
registering a subscriber for it. **Considered:** building the
subscriber to match the original framing literally. **Rejected:**
with exactly one producer and (still) zero consumers, a pub/sub
indirection is speculative infrastructure this codebase's own
discipline argues against — a direct call is simpler, equally testable,
and trivially upgradable to a real subscriber the day a second consumer
actually exists (`docs/M4_ARCHITECTURE_PROPOSAL.md` §29).

## M5 decisions

## 43. `outreach-experiments.routes.ts` gates every route — including plain reads — behind `requireHuman()`

Every other M5 router (`prospects`, `outreach-messages`,
`customer-responses`, `icp-profiles`) follows the M1-M4 convention:
`requireAuth()` for reads and agent-executable actions, `requireHuman()`
reserved for the one privileged safety gate each router owns.
`outreach-experiments.routes.ts` is the exception — its two `GET`s and
its general `POST /:id/status` are `requireHuman()` too, not just
`POST /` (create) and `POST /:id/approve` (the first hard gate).
**Considered:** loosening the two `GET`s to `requireAuth()` for
consistency with the other five routers. **Rejected, for now:** the
effect is fail-*closed* (an agent identity cannot read experiment state
over HTTP; internal orchestration never goes through HTTP anyway, so
nothing in this build is actually blocked by it) rather than fail-open,
so it is not a vulnerability — and `OutreachExperiment` is genuinely the
point where real, named prospects start being targeted, which is a
defensible reason to hold reads to a higher bar than M1-M4's own
convention would suggest. Recorded here so a future reader sees a
deliberate asymmetry, not an unexplained inconsistency
(`docs/SECURITY.md`, M5 section).

## 44. Pre-existing `qs`/`body-parser`/`express` moderate-severity advisories — recorded, not silently inherited

M2-M4's own `docs/SECURITY.md` sections each claimed `npm audit
--omit=dev` reported zero vulnerabilities. Running it again during M5's
security review shows 3 moderate-severity advisories against `qs`,
reached transitively through `body-parser`/`express`. `git diff HEAD --
package.json package-lock.json` confirms M5 changed neither file — this
is a newly-published advisory against dependencies pinned since M1
(`docs/DECISIONS.md` #1), not a regression M5's own code introduced.
`npm audit fix --omit=dev --dry-run` reports the identical 3 findings
afterward — no SemVer-compatible fix exists within `express` 4.x's own
constraint range today; the real fix is a deliberate Express
major-version upgrade affecting every milestone's HTTP layer at once.
**Considered:** running `npm audit fix --force` to close this out as
part of M5. **Rejected:** a forced major-version bump is exactly the
kind of hard-to-reverse, cross-cutting change that deserves its own
deliberate decision and full regression pass, not a side effect of an
M5 documentation task — recorded as a known, pre-existing gap instead
of silently carried forward the way the unchanged "zero vulnerabilities"
wording in an untouched section would otherwise have implied.

## 45. `buildDevProspectFixture`'s "organization" field: a real truncation bug the M5 capstone test caught

`prospectResearcherService`'s dev fixture built each discovered
prospect's `organization` field as `` `[DEV FIXTURE] Participant in
discussion: "${r.title}"`.slice(0, 200) `` — the per-result
discriminator (`#${index + 1}`) lived inside `r.title`, appended at the
very *end* of the string, after the ICP-derived query text. When an
ICP's role/industry/problemExposure text was long enough (routine once
`icpAnalystService`'s dev fixture starts deriving `role` from a real
`CUSTOMER_SEGMENT` claim's own full statement text), the outer
`.slice(0, 200)` truncated *before* reaching the discriminator, so all
3 prospects discovered from one research call silently collapsed to the
*same* `organization` string. This corrupts the exact independence
signal M5's entire negative-path safety logic depends on (`docs/M5_ARCHITECTURE_PROPOSAL.md`
§18, §20 — 3-independent-organizations is `STOP_EXPERIMENT`'s own
trigger condition) — the failure direction is conservative (fewer
apparent independent organizations, never more), so it is not a safety
hole, but it is a real correctness bug, not a cosmetic one. Caught by
`tests/integration/m5-end-to-end.test.ts`'s negative-path capstone
test asserting `new Set(respondents.map(p => p.organization)).size ===
3` before this fix — the assertion failed with `1`, not `3`. **Fixed**
by moving the discriminator to the *front* of the string
(`` `[DEV FIXTURE] Participant #${sourceIndex + 1} in discussion:
"${r.title}"` ``), so it survives truncation regardless of how long the
ICP-derived query text is. Same "verify before claiming done"
discipline as every other real bug this build has caught (#37).

## 46. `Prospect.qualificationStatus` and `Prospect.status` are deliberately two different fields, not redundant

`qualificationStatus` (`QUALIFIED`/`REJECTED`/`UNQUALIFIED`) is Prospect
Qualification's own finer-grained assessment; `status` is the coarser,
12-value lifecycle state machine every other M5 service actually
transitions against. `prospectQualificationService`'s own
`statusForQualification` collapses both `REJECTED` and `UNQUALIFIED`
qualificationStatus values to the same lifecycle `status: "REJECTED"` —
deliberately, since "does not proceed" is the only lifecycle-relevant
fact, while a human reading the record still benefits from knowing
*which* of the two it was (excluded outright vs. genuinely unclear from
public information). **Considered:** a single combined field.
**Rejected:** collapsing them would silently lose the
excluded-vs-unclear distinction the qualification prompt is explicitly
instructed to preserve (`PROSPECT_QUALIFICATION_SYSTEM_PROMPT`'s own
"an honest, valid outcome, never forced" framing for `UNQUALIFIED`).

## 47. The CEO's customer-discovery recommendation never auto-creates an `OutreachExperiment`

`ceoReasoningService.recommendCustomerDiscoveryAction` can recommend
`RUN_CUSTOMER_DISCOVERY` or `TEST_CLAIM` — both naturally read as "start
testing this claim with real prospects" — but the service only ever
writes a `CeoRecommendation` row; it never itself calls
`outreachExperimentService.create`. **Considered:** auto-creating a
`PENDING_APPROVAL` experiment for these two actions specifically, since
it still can't reach a real prospect without the separate, unchanged
`approve` hard gate. **Rejected** as the riskier reading of an
ambiguous line in this project's own earlier architecture proposal:
every other CEO action in this codebase (M4's `KILL`/`PREPARE_REVIEW`/
`HUMAN_REVIEW`) is already decoupled from mutation — the CEO
recommends, a human or a separate explicit service call acts. Customer
discovery is the one place that decoupling matters most (real people
end up contacted at the end of the chain it would start), so the same
"recommend only" discipline applies without exception, not a
milestone-specific carve-out.

## 48. Cost controls: no new mechanism, verified rather than assumed

M5's five new agents each declare their own `Partial<ExecutionBudget>`
override (`ICP_ANALYST_BUDGET`, `PROSPECT_RESEARCHER_BUDGET`,
`PROSPECT_QUALIFICATION_BUDGET`, `MESSAGE_DRAFTER_BUDGET`,
`RESPONSE_ANALYST_BUDGET`) through the same, unmodified
`agentRuntimeService` every M2-M4 agent already uses — no new budget
mechanism, no new `Permission`, no new risk level. `DEFAULT_OUTREACH_LIMITS`
(§26) is the one genuinely new layer, and it bounds *volume* (prospects/
messages per day/experiment), not spend. A repo-wide grep for
`estimatedCostUsd`/`maxCostUsd` in `src/services/` turns up exactly one
file — `research-cycle.service.ts`, unchanged since M3 — confirming
directly, not just by inference from the Phase 0 proposal, that M5
introduces no new dollar-denominated cost tracking or ceiling. The
`AgentExecution.estimatedCostUsd` gap (real usage isn't reported by the
provider in this environment) is unchanged from M2-M4 and stays exactly
as honestly documented there — carried forward, never quietly implied
to be solved by a milestone that didn't touch it.

## 49. `summarizeCalibration` gains a required `positiveDecision` parameter, rather than a second near-duplicate function

M5 extends calibration tracking (§32) to `CustomerDiscoveryMemo.confidence`
vs. `CustomerDiscoveryMemo.humanDecision` — the same shape as M4's
`DecisionRecord.confidenceAtDecision`/`humanDecision`, except the
"positive" label differs (`"APPROVE"` vs. `"APPROVED"`). **Considered:**
a second, near-identical `summarizeCustomerDiscoveryCalibration`
function duplicating the bucketing loop. **Rejected:** the bucketing
algorithm is real, non-trivial logic (five boundaries, a last-bucket
inclusive edge, an honest-null policy for missing confidence) — cloning
it would violate this codebase's own "three similar lines is fine, a
whole duplicated function is not" line. Instead `summarizeCalibration`
takes `positiveDecision` as a required (never defaulted) parameter, so
`calibrationService.summarize()` and the new
`calibrationService.summarizeCustomerDiscovery()` are each explicit
about which label they mean rather than silently sharing M4's own
hardcoded one. `CalibrationBucket`'s field names (`approvedCount`/
`approvedRate`) were deliberately left unrenamed — they read naturally
for `"APPROVE"` too, and renaming them would be a breaking change to
`GET /api/decision-records/calibration-summary`'s existing M4 response
shape for a purely cosmetic gain. A memo with `humanDecision: null`
(not yet decided) is filtered out in `calibrationService.summarizeCustomerDiscovery`
itself, before the shared function ever sees it — undecided is not the
same honest fact as decided-and-rejected, and conflating them would
silently understate the approval rate.

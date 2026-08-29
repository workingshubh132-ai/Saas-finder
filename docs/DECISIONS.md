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

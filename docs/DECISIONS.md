# Architectural Decisions

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

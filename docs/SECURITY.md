# Security

## Threat model for M1

M1 is a **single-tenant, trusted-caller backend**. It is designed to
be run by its founder (directly, or through internal automation they
control), not exposed to the public internet or to untrusted callers.
Everything below assumes that deployment boundary; widening it is a
"decision requiring founder approval" (see the M1 engineering report),
not something to do silently.

## No authentication — a documented decision, not an oversight

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

## Permission grants are explicit and human-gated

- Creating an agent, granting a permission, and revoking a permission
  all require `assertHumanOwner()` — the caller-supplied identity must
  be in the `HUMAN_OWNER_IDS` allow-list (`src/config.ts`). No agent id
  is ever placed in that list by the system.
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

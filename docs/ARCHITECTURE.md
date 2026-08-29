# Architecture

## Stack

TypeScript (Node 20+, ESM) · Express 4 · Prisma 5 / SQLite · Zod ·
Vitest + Supertest. Rationale for each choice is in `DECISIONS.md`.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ src/api/            Express routes + Zod validation.          │
│                      Translates HTTP ⇄ service calls. No       │
│                      business logic lives here.               │
├─────────────────────────────────────────────────────────────┤
│ src/services/        Application/business logic. Every state   │
│                      change and every authorization decision   │
│                      goes through here: validates input        │
│                      against domain rules, calls repositories, │
│                      writes an audit entry, publishes a         │
│                      domain event.                             │
├─────────────────────────────────────────────────────────────┤
│ src/db/repositories/ Thin, typed data access. One module per   │
│                      entity. No business rules — just reads    │
│                      and writes, shaped by the service layer.  │
├─────────────────────────────────────────────────────────────┤
│ src/domain/          Pure logic, zero I/O: enums (as TS union   │
│                      types), state-transition tables, the       │
│                      risk/permission policy, error classes.    │
│                      Everything here is unit-testable without   │
│                      a database.                                │
├─────────────────────────────────────────────────────────────┤
│ prisma/              Schema + migrations (SQLite).              │
└─────────────────────────────────────────────────────────────┘
```

Dependencies point one way: `api → services → db/repositories`, and
`services`/`db` both depend on `domain`, never the reverse. `domain`
imports nothing from any other layer.

## Request flow

```
HTTP request
   │
   ▼
Express route (src/api/routes/*.ts)
   │  Zod schema validates + types the body (validateBody middleware)
   ▼
Service function (src/services/*.ts)
   │  1. Validate against domain rules (isX() guards, state machines)
   │  2. Call repository functions (src/db/repositories/*.ts)
   │  3. auditService.record(...) — every important action
   │  4. eventBus.publish(...) — where a domain event is defined
   ▼
Repository (Prisma) → SQLite (FK + CHECK constraints enforced)
   │
   ▼
DomainError (if any) → error-handler.ts → HTTP status + JSON body
```

`asyncHandler` wraps every route so a rejected promise reaches
`error-handler.ts` (Express 4 does not do this automatically).
`DomainError` subclasses (`src/domain/shared/errors.ts`) carry their
own `statusCode`; anything else becomes a generic 500.

## Authorization as a service, not a decorator

`authorizationService.authorize({ agentId, action })` is the one path
that turns a requested action into `ALLOWED | DENIED | REQUIRES_APPROVAL`.
It is not middleware and nothing calls it implicitly — services that
represent a real capability grant (e.g. an agent actually reading the
web) are expected to call it explicitly. In M1, only `evidenceService`
and `opportunityService` exist as GREEN-level "internal" actions per
the Constitution's own classification (§8), so the vertical slice does
not call `authorize()` on every step; `authorization.test.ts` proves
the function itself works correctly across all four risk levels
independent of any particular caller.

## Approvals vs. authorization

These are two different mechanisms that meet at `RiskPolicy.requiresApproval`:

- **`authorizationService`** answers "is this agent currently allowed
  to do this?" — a synchronous, stateless-per-call check against
  granted permissions.
- **`approvalService`** is the stateful workflow for the subset of
  actions that need a **recorded human decision** before they proceed:
  create a request, a human (never the requester) decides it, the
  decision and its reasoning are persisted.

## Event bus (in-process outbox)

`src/services/event-bus.ts` persists every event to the `events` table
in the same call before fanning it out to in-process subscribers. M1
ships no subscribers — nothing in the vertical slice depends on async
side effects — but the seam exists for M2 (e.g. "on
`OPPORTUNITY_DISCOVERED`, notify Intelligence") without introducing a
message broker prematurely.

## Provider-agnostic seam

`src/domain/ports/model-provider.ts` defines a `ModelProvider`
interface so future agent-execution code never depends on a specific
LLM vendor. Nothing in M1 calls a real implementation of it — M1 has
no autonomous agent-execution loop — but `Agent.modelProvider` /
`Agent.modelName` are already plain descriptive strings, never a
hardcoded vendor enum, so adding a real implementation later touches
no schema.

## Directory map

```
src/
  config.ts                  Env config + fail-closed validation.
  index.ts                   HTTP entrypoint.
  domain/
    shared/                  errors.ts, state-machine.ts, json.ts
    risk/                    risk-level.ts, permission-risk-policy.ts
    permission/               permission.ts
    agent/ task/ approval/    status enums + transition tables
    opportunity/               status + validation-level
    evidence/ memory/ events/ audit/
    ports/                    model-provider.ts
  db/
    client.ts                 Prisma client singleton
    repositories/              one file per entity
  services/                   agent, task, authorization, approval,
                               evidence, opportunity, opportunity-scorer,
                               decision-queue, research-intake, audit,
                               event-bus
  api/
    app.ts                    Express app factory
    middleware/                async-handler, error-handler, validate, params
    routes/                    one router per resource
prisma/
  schema.prisma
  migrations/
tests/
  unit/                       pure domain logic, no DB
  integration/                real SQLite, one service/route at a time
  vertical-slice + api tests   the full M1 proof, service-level and HTTP-level
```

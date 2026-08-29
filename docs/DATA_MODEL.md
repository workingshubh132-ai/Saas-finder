# Data Model

SQLite via Prisma (`prisma/schema.prisma`). The SQLite connector has no
native enum type, so every enum-like column is a `String`, validated
at write time by TypeScript union types + Zod (API boundary) and
mirrored as a SQLite `CHECK` constraint in the migration for
defense-in-depth (see `SECURITY.md`). All JSON-shaped data (arrays,
free-form metadata) is stored as a JSON-encoded `String` for the same
connector reason.

## Agent (`agents`)

`id, name, role, department, description, status, capabilities (json),
model_provider?, model_name?, parent_agent_id? (self FK),
risk_level, created_at, updated_at`

- `status`: `ACTIVE | PAUSED | SUSPENDED | RETIRED`. `RETIRED` is
  terminal — Constitution §26, "no agent has an inherent right to
  remain active." Full transition table: `src/domain/agent/agent.types.ts`.
- `department`: the Constitution's seven CEO departments plus
  `EXECUTIVE` and `GUARDIAN`, so the whole hierarchy (§3) has
  somewhere to register, even though only the departments are
  "real" today.
- `risk_level`: the ceiling autonomy level this agent may ever operate
  at (separate from a given action's own risk level).
- `capabilities` is descriptive metadata (tags), **not** authorization
  — see `AgentPermission`.

## AgentPermission (`agent_permissions`)

`id, agent_id (FK→agents, cascade), permission, granted_by, granted_at,
revoked_by?, revoked_at?, reason?`

An explicit grant, never implicit. "Active" means `revoked_at IS NULL`.
Both grant and revoke require a Human Owner identity
(`agentService.grantPermission` / `revokePermission`) — an agent id is
never on that allow-list, which is what stops an agent granting itself
a capability.

## Task (`tasks`)

`id, title, objective, assigned_agent_id? (FK→agents, SET NULL),
parent_task_id? (self FK, SET NULL), status, priority, risk_level,
input? (json), output? (json), error?, created_at, started_at?, completed_at?`

Status: `PENDING → QUEUED → RUNNING → {COMPLETED | FAILED | CANCELLED}`,
plus `PENDING → CANCELLED`. `QUEUED → CANCELLED` was added beyond the
M1 brief's literal example list so a queued-but-not-started task is
still cancellable — see `DECISIONS.md`. All three end states are
terminal.

## ApprovalRequest (`approval_requests`)

`id, requested_by_agent_id (FK→agents, RESTRICT), action, description,
risk_level, resource_type?, resource_id?, evidence? (json id array),
reason?, status, reviewed_by?, reviewed_at?, decision_reason?,
created_at, expires_at?`

Status: `PENDING → {APPROVED | REJECTED | MODIFIED | DEFERRED |
CANCELLED | EXPIRED}`, and `DEFERRED → PENDING` (the
`REQUEST_MORE_EVIDENCE` round-trip). Every other resolved status is
terminal. `resource_type`/`resource_id` are **not** in the M1 brief's
literal field list — added because nothing else lets the Human
Decision Queue answer "an approval for *what*?" (see `DECISIONS.md`).

## Evidence (`evidence`)

`id, claim, source, source_type, source_reference?,
collected_by_agent_id (FK→agents, RESTRICT), collected_at, reliability,
confidence (0..1), verification_status, metadata? (json), created_at, updated_at`

- `reliability` (`LOW|MEDIUM|HIGH`) is trustworthiness of the *source*;
  `confidence` (float, 0..1) is the collector's confidence in the
  specific *claim*. Different axes, both required.
- `verification_status`: `UNVERIFIED → {PARTIALLY_VERIFIED | VERIFIED |
  DISPUTED | REJECTED}`, plus `VERIFIED ↔ DISPUTED` (a later claim can
  contradict a previously verified one) and `DISPUTED → PARTIALLY_VERIFIED`.
  `REJECTED` is terminal.
- There is no path that creates an Evidence row except
  `evidenceService.collectEvidence` — an agent's conclusion is never
  automatically evidence (Constitution §31 of the governing document).

## Opportunity (`opportunities`)

`id, title, problem, target_customer, description, status,
opportunity_score? (0..1), confidence_score? (0..1), validation_level,
created_at, updated_at, metadata? (json)`

- Status: `DISCOVERED → RESEARCHING → VALIDATING → {VALIDATED |
  REJECTED} `, `VALIDATED → APPROVED`, and `ARCHIVED` reachable from
  every non-terminal state.
- `opportunity_score` and `confidence_score` are both normalized 0..1
  and kept as **separate** values, per Constitution §12: a high score
  with low confidence should trigger more research, not execution.
- `validation_level`: `LEVEL_0`..`LEVEL_8` (Constitution §14 labels, in
  `src/domain/opportunity/validation-level.ts`). M1 enforces one
  foundation-level guard — a level above `LEVEL_0` requires at least
  one attached Evidence row — not the full policy of which evidence
  mix justifies which level. See `DECISIONS.md`.

## OpportunityEvidence (`opportunity_evidence`)

Join table, `(opportunity_id, evidence_id)` unique, both FKs
`CASCADE`. Many-to-many: an opportunity has many evidence records, one
evidence record can back more than one opportunity.

## OpportunityScoreRecord (`opportunity_score_records`)

`id, opportunity_id (FK, CASCADE), dimensions (json), opportunity_score,
confidence_score, scored_by, created_at`

History of every scoring run — a re-score never erases the trail
behind an earlier decision. Not in the M1 brief's literal field list;
added because "the system should be able to answer why it believes
this" (Constitution §11) requires the score's own history, not just
its current value.

## Memory (`memories`)

`id, type (WORKING|EPISODIC|STRATEGIC), subject, content, source?,
confidence? (0..1), created_at, metadata? (json)`

Deliberately minimal: a typed, queryable record with no retrieval
ranking or embeddings (M1 brief §13 explicitly defers vector search).

## Event (`events`)

`id, type, payload (json), occurred_at`

Append-style outbox. `type` is one of the twelve values in
`src/domain/events/event.types.ts` — the M1 brief's named minimum set.

## AuditLog (`audit_logs`)

`id, actor_type (AGENT|HUMAN|SYSTEM), actor_id?, action, resource_type,
resource_id?, risk_level?, result (SUCCESS|FAILURE|DENIED), reason?,
metadata? (json), timestamp`

Answers who / did what / to what / when / why / with what result.
`REQUIRES_APPROVAL` authorization outcomes are recorded as `SUCCESS`
(the check itself succeeded in classifying the action) — only an
outright `DENIED` decision is recorded as `DENIED`; `FAILURE` is
reserved for a task/action that actually failed. Append-only from the
application layer: `src/db/repositories/audit.repository.ts` exports
no update or delete function.

## Entity relationships

```
Agent ──1:N──► AgentPermission
Agent ──1:N──► Task (assigned_agent_id, optional)
Agent ──1:N──► ApprovalRequest (requested_by_agent_id, required)
Agent ──1:N──► Evidence (collected_by_agent_id, required)
Agent ──1:N──► Agent (parent_agent_id, self, optional)
Task  ──1:N──► Task (parent_task_id, self, optional)
Opportunity ──M:N──► Evidence   (via OpportunityEvidence)
Opportunity ──1:N──► OpportunityScoreRecord
ApprovalRequest ──0:1──► (resource_type, resource_id) → any entity, loosely typed
```

## Indexing decisions

Indexes follow the queries M1's services actually run:
`agents(status)`/`(department)` for listing/filtering; `agent_permissions(agent_id, permission)`
for the "does this agent hold an active grant" check that runs on
every `authorize()` call; `tasks(status)`/`(assigned_agent_id)` for
queue-style listing; `approval_requests(status)` for the Human
Decision Queue's `PENDING` scan and `(resource_type, resource_id)` for
looking up a resource's approval history; `evidence(collected_by_agent_id)`/`(source_type)`;
`opportunities(status)`; `opportunity_score_records(opportunity_id)`
for score history lookups; `memories(type, subject)`;
`events(type)`; and `audit_logs(resource_type, resource_id)`/`(actor_id)`/`(timestamp)`
for the three ways audit history actually gets queried (by resource,
by actor, chronologically).

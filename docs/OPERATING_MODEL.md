# Operating Model

## What this is

This is **M1 — the VentureForge Operating Kernel**: the smallest
production-quality technical foundation capable of eventually
supporting the full company described in `CONSTITUTION.md`.

M1 does **not** implement the CEO, Chairman, or Guardian as reasoning
agents. It implements the primitives those roles will be built on top
of: an Agent Registry, a Task Engine, a Permission system, a Risk
classification, an Approval Engine, an Evidence Engine, an Opportunity
Engine with scoring, a Memory foundation, an Event log, an Audit log,
and a Human Decision Queue — wired together into one proven vertical
slice.

Where the Constitution describes a role or process M1 doesn't
implement yet (Chairman review, Guardian intelligence, sales
automation, the SaaS factory, portfolio management), this document
says so explicitly rather than implying it exists.

## The hierarchy, as M1 actually enforces it

```
HUMAN OWNER   — the only actor who can approve/reject a governed decision,
                grant or revoke an agent's permissions, or create an agent.
                Enforced by config.humanOwnerIds (see SECURITY.md).

CHAIRMAN      — not implemented as an agent. RiskPolicy.requiresChairman
                is recorded on ORANGE-level decisions as metadata for a
                future Chairman workflow to consume; today those
                decisions route straight to the Human Owner, who is the
                Constitution's ultimate authority anyway (§2).

CEO           — not implemented as an agent. Nothing in M1 autonomously
                prioritizes opportunities or allocates resources; a
                human (or a script acting as one) drives the kernel's
                services directly or through the HTTP API.

GUARDIAN      — not implemented as a reasoning agent. Its job in M1 is
                done by static code: the authorization service, the
                permission grant model, and the CHECK-constrained
                schema. See ARCHITECTURE.md and SECURITY.md.

Departments / — represented only as an Agent Registry field
Specialized     (`department`) and free-text `role`. No department has
Agents          its own logic yet.
```

## Autonomy levels, as implemented

GREEN/YELLOW/ORANGE/RED (Constitution §8) are a first-class domain
concept (`src/domain/risk/risk-level.ts`), not a free-form string.
Every permission is classified into one of the four
(`src/domain/risk/permission-risk-policy.ts`), and `authorizationService.authorize()`
is the single place that turns `(agent, action)` into a decision:

```
action ──► permission's risk level ──► RiskPolicy
                                          │
                     requiresApproval? ──┼── no  → ALLOWED
                                         yes → REQUIRES_APPROVAL
```

`REQUIRES_APPROVAL` does not execute anything — it tells the caller an
`ApprovalRequest` is needed. Creating that request, and a human
deciding it, are separate, audited steps (`approvalService`). RED
actions are additionally marked `autoExecutableAfterApproval: false`:
even once approved, M1's data model records that a human — not the
system — must be the one to carry the action out. M1 has no
actuator that executes approved actions in the real world yet, so
this is currently a recorded intent rather than an enforced runtime
gate; whichever M2 component adds real execution must check this flag
before ever auto-running a RED-approved action.

## The decision queue, as implemented

`decisionQueueService` is a read model over `ApprovalRequest` rows
with `status = PENDING`, enriched with the Evidence and Opportunity
they reference so a human can decide without leaving the queue. There
is no weekday/weekend scheduler in M1 — the Constitution's weekly
cycle (§9) is a human process the queue supports (decisions
accumulate whenever agents request them; the Human Owner can review in
a batch at any cadence they choose), not something the kernel
enforces or automates.

## The slice M1 proves

```
Research Signal (caller-supplied, structured — never scraped or fabricated)
      │
      ▼
Create Opportunity  ────────────────►  audited, DOMAIN_EVENT: OPPORTUNITY_DISCOVERED
      │
      ▼
Collect + Attach Evidence  ─────────►  audited, DOMAIN_EVENT: EVIDENCE_ADDED
      │
      ▼
Score Opportunity  ──────────────────► audited, DOMAIN_EVENT: OPPORTUNITY_SCORED
      │
      ▼
Request Approval  ───────────────────► audited, DOMAIN_EVENT: APPROVAL_REQUESTED
      │
      ▼
Human Decision Queue  ────────────────► Human Owner: APPROVE / REJECT / MODIFY /
                                          DEFER / REQUEST_MORE_EVIDENCE
```

`src/services/research-intake.service.ts` is this flow as one
orchestration function; `tests/integration/vertical-slice.test.ts`
exercises it end to end (service layer) and `tests/integration/api.test.ts`
exercises the same flow over HTTP. Everything past "Request Approval"
in the Constitution's full core loop (§33) — Sell, Build, Launch,
Operate — is out of M1's scope.

## What M1 deliberately does not do

Sales automation, the SaaS factory, portfolio management (SCALE /
MAINTAIN / INVESTIGATE / PIVOT / PAUSE / RETIRE), a reasoning CEO or
Chairman, and Guardian-as-intelligence are all future milestones. M1
gives them a foundation — typed entities, an audited approval gate, an
evidence trail — not an implementation.
